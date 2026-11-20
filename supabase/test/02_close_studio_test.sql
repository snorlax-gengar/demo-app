-- =============================================================================
-- 스튜디오 운영 종료 테스트 데이터 — Supabase SQL Editor 에서 실행 (패치 014 적용 후)
--
-- 아래 v_password 한 곳만 바꾸고 [1] 전체를 실행하세요. 실제 운영 중인 스튜디오는 건드리지 않고,
-- 테스트 전용 스튜디오 2곳과 테스트 계정 5개를 새로 만듭니다.
--
--   ① [테스트] 운영종료 스튜디오  — 원장 test.owner (테스트원장)
--        회원 test.close1 (테스트종료회원1) : 그룹 10회권 → 수업 2개 예약 → 잔여 8회
--        회원 test.close2 (테스트종료회원2) : 그룹 10회권 → 수업 1개 예약 → 잔여 9회
--        강사 test.close.teacher (테스트종료강사)
--        수업: 모레 19:00 '[테스트] 종료 확인 그룹'(정원 2, 회원1·2 확정 = 만석)
--              글피 10:00 '[테스트] 종료 확인 소그룹'(정원 4, 회원1 확정)
--        → 운영 종료 미리보기 예상: 폐강될 수업 2 · 취소될 예약·대기 3 · 알림 받을 사람 3
--
--   ② [테스트] 1인 스튜디오        — 원장 test.solo (테스트1인원장) 혼자, 본인 담당 수업 1개(모레 18:00)
--        → 탈퇴하면 스튜디오가 자동으로 운영 종료되는지 확인용
--
-- 비밀번호는 다섯 계정 모두 v_password 로 같습니다 (예: test.owner@example.com / v_password).
-- 여러 번 실행해도 안전합니다. 이미 종료된 테스트 스튜디오가 있으면 새로 하나 더 만들어 다시 테스트할 수 있습니다.
-- 결과 확인: 아래 [2] 확인 쿼리 (테스트 단계마다 다시 실행)
-- 정리: supabase/test/99_cleanup_test_data.sql
-- =============================================================================

-- [1] 테스트 데이터 준비 -------------------------------------------------------
do $$
declare
  v_password text := '여기에_테스트_비밀번호';  -- ← 바꾸세요 (8자 이상)

  v_uid     uuid;
  v_owner   uuid;  v_solo uuid;  v_teacher uuid;  v_m1 uuid;  v_m2 uuid;
  v_studio  public.studios;
  v_solo_st public.studios;
  v_c1 uuid;  v_c2 uuid;
  v_solo_ok boolean := true;
  r record;
begin
  if v_password like '여기에%' or char_length(v_password) < 8 then
    raise exception 'v_password 를 8자 이상으로 바꿔 주세요.';
  end if;

  -- 1) 테스트 계정 5개 (이메일 인증 완료 상태, 약관 동의 완료로 표시해 바로 앱 사용 가능)
  for r in
    select * from (values
      ('test.owner@example.com',         '테스트원장',      1),
      ('test.close1@example.com',        '테스트종료회원1', 2),
      ('test.close2@example.com',        '테스트종료회원2', 3),
      ('test.close.teacher@example.com', '테스트종료강사',  4),
      ('test.solo@example.com',          '테스트1인원장',   5)
    ) as t(email, name, n)
  loop
    select id into v_uid from auth.users where email = r.email;
    if v_uid is null then
      v_uid := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', r.email,
        extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('name', r.name, 'phone', '010-0000-010' || r.n, 'terms_agreed_at', now()),
        now(), now(), '', '', '', ''
      );
      insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (
        v_uid::text, v_uid,
        jsonb_build_object('sub', v_uid::text, 'email', r.email, 'email_verified', true, 'phone_verified', false),
        'email', now(), now(), now()
      );
      -- public.users 프로필은 가입 트리거(on_auth_user_created)가 만든다
    end if;
    if exists (select 1 from public.users where id = v_uid and withdrawn_at is not null) then
      if r.n = 5 then
        v_solo_ok := false;   -- 1인 원장 탈퇴 테스트를 이미 마친 상태 → ② 준비만 건너뜀
        raise notice 'test.solo 는 이미 탈퇴해 ② 1인 스튜디오 준비를 건너뜁니다. 다시 하려면 99_cleanup_test_data.sql 실행 후 재실행';
      else
        raise exception '% 계정은 이미 탈퇴 처리되었습니다. 99_cleanup_test_data.sql 로 정리한 뒤 다시 실행해 주세요.', r.email;
      end if;
    end if;
    case r.n
      when 1 then v_owner := v_uid;  when 2 then v_m1 := v_uid;  when 3 then v_m2 := v_uid;
      when 4 then v_teacher := v_uid; else v_solo := v_uid;
    end case;
  end loop;

  -- 2) ① 운영 종료용 스튜디오: 종료 안 된 것이 있으면 재사용, 없으면 앱과 같은 함수로 새로 만들기
  select s.* into v_studio from public.studios s
   where s.name = '[테스트] 운영종료 스튜디오' and s.created_by = v_owner and s.closed_at is null
   order by s.created_at desc limit 1;
  if v_studio.id is null then
    perform set_config('request.jwt.claim.sub', v_owner::text, true);    -- 테스트원장으로 로그인한 것처럼
    select * into v_studio from public.create_studio('[테스트] 운영종료 스튜디오');
  end if;

  -- 회원·강사 소속 (앱의 초대 코드 참여와 같은 함수)
  for r in select unnest(array[v_m1, v_m2, v_teacher]) as uid loop
    if not exists (select 1 from public.studio_members where studio_id = v_studio.id and user_id = r.uid and status = 'active') then
      perform set_config('request.jwt.claim.sub', r.uid::text, true);
      perform public.join_studio(v_studio.invite_code);
    end if;
  end loop;
  update public.studio_members set role = 'instructor'
   where studio_id = v_studio.id and user_id = v_teacher and role <> 'instructor';

  -- 수강권 (그룹 10회권, 이미 있으면 건너뜀)
  insert into public.passes (studio_id, member_id, class_type, name, total_count, remaining_count, starts_on, expires_on)
  select v_studio.id, m, 'group', '[테스트] 그룹 10회권', 10, 10, current_date, current_date + 90
    from unnest(array[v_m1, v_m2]) as m
   where not exists (select 1 from public.passes where studio_id = v_studio.id and member_id = m);

  -- 수업 2개 (한국 시간 기준)
  select id into v_c1 from public.classes
   where studio_id = v_studio.id and title = '[테스트] 종료 확인 그룹' and status = 'scheduled';
  if v_c1 is null then
    insert into public.classes (studio_id, title, instructor_id, starts_at, ends_at, max_capacity, location)
    values (v_studio.id, '[테스트] 종료 확인 그룹', v_teacher,
            ((current_date + 2) + time '19:00') at time zone 'Asia/Seoul',
            ((current_date + 2) + time '19:50') at time zone 'Asia/Seoul', 2, '테스트룸')
    returning id into v_c1;
  end if;
  select id into v_c2 from public.classes
   where studio_id = v_studio.id and title = '[테스트] 종료 확인 소그룹' and status = 'scheduled';
  if v_c2 is null then
    insert into public.classes (studio_id, title, instructor_id, starts_at, ends_at, max_capacity, location)
    values (v_studio.id, '[테스트] 종료 확인 소그룹', v_teacher,
            ((current_date + 3) + time '10:00') at time zone 'Asia/Seoul',
            ((current_date + 3) + time '10:50') at time zone 'Asia/Seoul', 4, '테스트룸')
    returning id into v_c2;
  end if;

  -- 예약 (앱과 같은 예약 함수): 회원1 → 수업1·2 확정, 회원2 → 수업1 확정
  for r in select * from (values (v_m1, v_c1), (v_m2, v_c1), (v_m1, v_c2)) as t(uid, cid) loop
    if not exists (select 1 from public.bookings where class_id = r.cid and member_id = r.uid and status <> 'cancelled') then
      perform set_config('request.jwt.claim.sub', r.uid::text, true);
      perform public.book_class(r.cid);
    end if;
  end loop;

  -- 3) ② 1인 스튜디오 (원장 혼자 + 본인 담당 예정 수업 1개)
  select s.* into v_solo_st from public.studios s
   where s.name = '[테스트] 1인 스튜디오' and s.created_by = v_solo and s.closed_at is null
   order by s.created_at desc limit 1;
  if v_solo_st.id is null and v_solo_ok then
    perform set_config('request.jwt.claim.sub', v_solo::text, true);
    select * into v_solo_st from public.create_studio('[테스트] 1인 스튜디오');
    insert into public.classes (studio_id, title, instructor_id, starts_at, ends_at, max_capacity, location)
    values (v_solo_st.id, '[테스트] 1인 수업', v_solo,
            ((current_date + 2) + time '18:00') at time zone 'Asia/Seoul',
            ((current_date + 2) + time '18:50') at time zone 'Asia/Seoul', 4, '테스트룸');
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  raise notice '완료: ① % (초대 코드 %) / ② % (초대 코드 %)',
    v_studio.name, v_studio.invite_code, coalesce(v_solo_st.name, '(건너뜀)'), coalesce(v_solo_st.invite_code, '-');
end $$;


-- [2] 확인 쿼리 — 준비 직후 / 운영 종료 후 / 1인 원장 탈퇴 후 각각 실행해 비교 --------------
with st as (
  select s.* from public.studios s
   where s.name in ('[테스트] 운영종료 스튜디오', '[테스트] 1인 스튜디오')
)
select '스튜디오' as 구분, st.name as 대상,
       case when st.closed_at is null then '운영 중' else '운영 종료 ' || to_char(st.closed_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') end as 상태,
       st.invite_code as 값
  from st
union all
select '소속', st.name || ' · ' || u.name || ' (' || sm.role || ')', sm.status, null
  from st join public.studio_members sm on sm.studio_id = st.id join public.users u on u.id = sm.user_id
union all
select '수업', st.name || ' · ' || c.title, c.status,
       (select count(*) filter (where b.status = 'confirmed') || '확정 / ' || count(*) filter (where b.status = 'waitlist') || '대기 / '
             || count(*) filter (where b.status = 'cancelled') || '취소' from public.bookings b where b.class_id = c.id)
  from st join public.classes c on c.studio_id = st.id
union all
select '수강권', st.name || ' · ' || u.name, case when p.is_active then '사용 가능' else '중지' end, p.remaining_count || ' / ' || p.total_count || '회'
  from st join public.passes p on p.studio_id = st.id join public.users u on u.id = p.member_id
union all
select '알림', st.name || ' · ' || u.name, n.kind, n.title
  from st join public.notifications n on n.studio_id = st.id join public.users u on u.id = n.user_id
 where n.kind = 'studio_closed'
union all
select '계정', u.email, case when pu.withdrawn_at is null then '사용 중' else '탈퇴' end, null
  from auth.users u left join public.users pu on pu.id = u.id
 where u.email in ('test.owner@example.com', 'test.solo@example.com')
 order by 1, 2;
