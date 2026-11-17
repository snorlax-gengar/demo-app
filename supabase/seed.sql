-- =============================================================================
-- 데모 데이터 (선택) — schema.sql 실행 후, 앱에서 계정을 몇 개 가입시킨 다음 실행
--
--  1) 아래 두 이메일을 원장·강사로 쓸 가입 계정으로 바꾸세요.
--  2) 실행하면:
--     - '데모 필라테스' 스튜디오 생성 (초대 코드 DEMO22)
--     - 원장·강사 지정, 나머지 모든 가입자는 이 스튜디오의 회원으로 등록
--     - 오늘부터 14일간 원장·강사별 하루 4개 수업
--     - 회원마다 1:1 10회권 + 4:1 그룹 20회권
--  여러 번 실행해도 안전합니다(이미 있는 것은 건너뜀).
--  앱에서 직접 만든 스튜디오와는 별개입니다.
-- =============================================================================
do $$
declare
  v_owner_email      text := 'owner@example.com';    -- ← 원장 계정 이메일
  v_instructor_email text := 'teacher@example.com';  -- ← 강사 계정 이메일
  v_owner   uuid;
  v_studio  uuid;
begin
  select id into v_owner from public.users where email = v_owner_email;
  if v_owner is null then
    raise exception '% 로 가입된 계정이 없습니다. 앱에서 먼저 가입하거나 이메일을 바꿔 주세요.', v_owner_email;
  end if;

  insert into public.studios (name, invite_code, created_by)
  values ('데모 필라테스', 'DEMO22', v_owner)
  on conflict (invite_code) do update set name = excluded.name
  returning id into v_studio;

  insert into public.studio_members (studio_id, user_id, role)
  values (v_studio, v_owner, 'owner')
  on conflict (studio_id, user_id) do nothing;

  insert into public.studio_members (studio_id, user_id, role)
  select v_studio, id, 'instructor' from public.users where email = v_instructor_email
  on conflict (studio_id, user_id) do update set role = 'instructor'
  where public.studio_members.role = 'member';

  -- 나머지 가입자 전원을 회원으로
  insert into public.studio_members (studio_id, user_id, role)
  select v_studio, id, 'member' from public.users
  on conflict (studio_id, user_id) do nothing;

  -- 2주치 수업 (한국 시간 기준, 겹치는 시간은 건너뜀)
  insert into public.classes (studio_id, title, instructor_id, starts_at, ends_at, max_capacity, location)
  select
    v_studio, t.title, sm.user_id,
    ((current_date + d.day_offset) + make_time(t.hour, 0, 0)) at time zone 'Asia/Seoul',
    ((current_date + d.day_offset) + make_time(t.hour, 50, 0)) at time zone 'Asia/Seoul',
    t.capacity, t.location
  from public.studio_members sm
  cross join generate_series(0, 13) as d(day_offset)
  cross join (values
    ('1:1 개인 레슨',      10, 1, 'A룸'),
    ('1:1 개인 레슨',      14, 1, 'A룸'),
    ('4:1 그룹 리포머',    19, 4, 'B룸'),
    ('4:1 그룹 체어·바렐', 20, 4, 'B룸')
  ) as t(title, hour, capacity, location)
  where sm.studio_id = v_studio and sm.role in ('owner', 'instructor')
  on conflict do nothing;

  -- 수강권이 없는 회원에게 2종 발급
  insert into public.passes (studio_id, member_id, class_type, name, total_count, remaining_count, starts_on, expires_on)
  select v_studio, sm.user_id, p.class_type, p.name, p.total, p.total, current_date, current_date + p.valid_days
  from public.studio_members sm
  cross join (values
    ('private', '1:1 개인 10회권', 10, 90),
    ('group',   '4:1 그룹 20회권', 20, 120)
  ) as p(class_type, name, total, valid_days)
  where sm.studio_id = v_studio and sm.role = 'member'
    and not exists (select 1 from public.passes x where x.studio_id = v_studio and x.member_id = sm.user_id);

  raise notice '데모 스튜디오 준비 완료. 초대 코드: DEMO22';
end $$;
