-- =============================================================================
-- 테스트 데이터 준비 — Supabase SQL Editor 에서 실행 (개발용 DB 에서만!)
--
-- 아래 두 값만 바꾸고 전체 실행하세요.
--   v_invite_code : 앱 '내 정보' 화면에 보이는 우리 스튜디오 초대 코드
--   v_password    : 테스트 계정 비밀번호 (직접 정하세요, 8자 이상)
--
-- 만들어지는 것 (모두 이름에 '테스트' 또는 '[테스트]' 표시)
--   · 테스트 계정 7개: test.member1~6@example.com (회원), test.instructor@example.com (강사)
--       - 회원1~4 : 그룹 20회권 + 1:1 10회권
--       - 회원5   : 그룹 10회권 중 잔여 2회   → '잔여 3회 이하' 필터 확인용
--       - 회원6   : 수강권 없음               → '수강권 없음' 필터 확인용
--   · [테스트] 수업 2개 (모레, 테스트강사 담당)
--       - 19:00 '[테스트] 대기열 확인 그룹' 정원 2명 → 회원1·2가 예약해 만석 (대기 신청 테스트용)
--       - 20:00 '[테스트] 예약·취소 확인 그룹' 정원 4명 → 비어 있음 (예약 차감·취소 복구 테스트용)
--   · 우리 스튜디오 회원 중 그룹 수강권이 없는 사람에게 '[테스트] 그룹 20회권' 발급
--     (본인 회원 계정으로 바로 예약해 볼 수 있도록)
--
-- 여러 번 실행해도 안전합니다(이미 있는 것은 건너뜀).
-- 정리: supabase/test/99_cleanup_test_data.sql
-- =============================================================================
do $$
declare
  v_invite_code text := '여기에_초대코드';        -- ← 바꾸세요 (예: 7K3QXA)
  v_password    text := '여기에_테스트_비밀번호';  -- ← 바꾸세요 (8자 이상)

  v_studio    uuid;
  v_uid       uuid;
  v_teacher   uuid;
  v_full      uuid;
  v_open      uuid;
  v_day       date := current_date + 2;          -- 모레 (24시간 넘게 남아 취소 시 복구 확인 가능)
  r           record;
begin
  if v_password like '여기에%' or char_length(v_password) < 8 then
    raise exception 'v_password 를 8자 이상으로 바꿔 주세요.';
  end if;

  select id into v_studio from public.studios
   where invite_code = upper(regexp_replace(v_invite_code, '[^A-Za-z0-9]', '', 'g'));
  if v_studio is null then
    raise exception '초대 코드 % 에 해당하는 스튜디오가 없습니다. 앱의 내 정보 화면에서 확인해 주세요.', v_invite_code;
  end if;

  -- 1) 테스트 계정 (이메일 인증 완료 상태, 이메일·비밀번호로 로그인 가능)
  for r in
    select * from (values
      ('test.member1@example.com',   '테스트회원1', 'member',     1),
      ('test.member2@example.com',   '테스트회원2', 'member',     2),
      ('test.member3@example.com',   '테스트회원3', 'member',     3),
      ('test.member4@example.com',   '테스트회원4', 'member',     4),
      ('test.member5@example.com',   '테스트회원5', 'member',     5),
      ('test.member6@example.com',   '테스트회원6', 'member',     6),
      ('test.instructor@example.com','테스트강사',  'instructor', 9)
    ) as t(email, name, role, n)
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
        jsonb_build_object('name', r.name, 'phone', '010-0000-000' || r.n),
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

    insert into public.studio_members (studio_id, user_id, role)
    values (v_studio, v_uid, r.role)
    on conflict (studio_id, user_id) do update set role = excluded.role, status = 'active';

    if r.role = 'instructor' then
      v_teacher := v_uid;
    end if;

    -- 수강권 (이미 이 스튜디오 수강권이 있으면 건너뜀). '발급' 변동 내역은 트리거가 기록
    if r.role = 'member' and not exists (
      select 1 from public.passes where studio_id = v_studio and member_id = v_uid
    ) then
      if r.email like 'test.member5%' then
        insert into public.passes (studio_id, member_id, class_type, name, total_count, remaining_count, starts_on, expires_on)
        values (v_studio, v_uid, 'group', '[테스트] 그룹 10회권', 10, 2, current_date - 60, current_date + 30);
      elsif r.email not like 'test.member6%' then
        insert into public.passes (studio_id, member_id, class_type, name, total_count, remaining_count, starts_on, expires_on)
        values (v_studio, v_uid, 'group',   '[테스트] 그룹 20회권',   20, 20, current_date, current_date + 90),
               (v_studio, v_uid, 'private', '[테스트] 1:1 개인 10회권', 10, 10, current_date, current_date + 90);
      end if;
    end if;
  end loop;

  -- 2) 그룹 수강권이 없는 기존 회원(본인 회원 계정 등)에게 테스트 수강권
  insert into public.passes (studio_id, member_id, class_type, name, total_count, remaining_count, starts_on, expires_on)
  select v_studio, sm.user_id, 'group', '[테스트] 그룹 20회권', 20, 20, current_date, current_date + 90
    from public.studio_members sm
   where sm.studio_id = v_studio and sm.role = 'member' and sm.status = 'active'
     and sm.user_id not in (select id from auth.users where email like 'test.%@example.com')  -- 테스트 계정은 1)에서 처리
     and not exists (
       select 1 from public.passes p
        where p.studio_id = v_studio and p.member_id = sm.user_id and p.class_type = 'group'
          and p.is_active and p.remaining_count > 0 and p.expires_on >= current_date
     );

  -- 3) [테스트] 수업 2개 (한국 시간 기준, 이미 있으면 재사용)
  select id into v_full from public.classes
   where studio_id = v_studio and title = '[테스트] 대기열 확인 그룹' and status = 'scheduled' and starts_at > now();
  if v_full is null then
    insert into public.classes (studio_id, title, instructor_id, starts_at, ends_at, max_capacity, location)
    values (v_studio, '[테스트] 대기열 확인 그룹', v_teacher,
            (v_day + time '19:00') at time zone 'Asia/Seoul', (v_day + time '19:50') at time zone 'Asia/Seoul', 2, '테스트룸')
    returning id into v_full;
  end if;

  select id into v_open from public.classes
   where studio_id = v_studio and title = '[테스트] 예약·취소 확인 그룹' and status = 'scheduled' and starts_at > now();
  if v_open is null then
    insert into public.classes (studio_id, title, instructor_id, starts_at, ends_at, max_capacity, location)
    values (v_studio, '[테스트] 예약·취소 확인 그룹', v_teacher,
            (v_day + time '20:00') at time zone 'Asia/Seoul', (v_day + time '20:50') at time zone 'Asia/Seoul', 4, '테스트룸');
  end if;

  -- 4) 회원1·2 가 앱과 같은 예약 함수(book_class)로 예약 → 대기열 수업 만석
  for r in select id from auth.users where email in ('test.member1@example.com', 'test.member2@example.com') order by email loop
    if not exists (select 1 from public.bookings where class_id = v_full and member_id = r.id and status <> 'cancelled') then
      perform set_config('request.jwt.claim.sub', r.id::text, true);   -- 그 회원으로 로그인한 것처럼
      perform public.book_class(v_full);
    end if;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);

  raise notice '완료: 테스트 계정 7개, [테스트] 수업 2개(대기열 확인 수업 %/2명)',
    (select count(*) from public.bookings where class_id = v_full and status = 'confirmed');
end $$;

-- 결과 확인
select u.email, sm.role, coalesce(sum(p.remaining_count), 0) as 잔여횟수
  from auth.users u
  join public.studio_members sm on sm.user_id = u.id
  left join public.passes p on p.member_id = u.id and p.studio_id = sm.studio_id
 where u.email like 'test.%@example.com'
 group by u.email, sm.role
 order by u.email;
