-- =============================================================================
-- 운영자용: 스튜디오 운영 종료 요청 처리 (Supabase SQL Editor 에서 필요한 부분만 골라 실행)
--   남은 수강권이 있는 스튜디오의 원장이 앱에서 "운영 종료 요청"을 보내면 여기서 확인·승인·반려합니다.
--   승인하면 즉시 운영 종료(앞으로의 수업 폐강·확정 예약 수강권 복구·회원 알림·전원 탈퇴), 원장에게 결과 알림.
-- =============================================================================

-- [0] 운영자 등록 (한 번만) — 요청이 들어오면 이 계정으로 앱 알림·푸시가 옵니다
insert into public.app_operators (user_id)
select id from auth.users where email = '여기에_운영자_앱계정_이메일'
on conflict do nothing;
select u.email from public.app_operators o join auth.users u on u.id = o.user_id;   -- 등록 확인


-- [1] 검토 대기 중인 요청
select r.id                                              as 요청_id,
       s.name                                            as 스튜디오,
       u.name                                            as 원장,
       au.email                                          as 원장_이메일,
       u.phone                                           as 원장_연락처,
       r.reason                                          as 사유,
       (r.open_passes->>'members')::int                  as 요청시_회원수,
       (r.open_passes->>'remaining')::int                as 요청시_남은횟수,
       to_char(r.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as 요청_시각
  from public.studio_close_requests r
  join public.studios s on s.id = r.studio_id
  left join public.users u on u.id = r.requested_by
  left join auth.users au on au.id = r.requested_by
 where r.status = 'pending'
 order by r.created_at;


-- [2] 지금 기준 남은 수강권 회원 명단 (회원에게 정리됐는지 확인할 때) — 요청 id 를 넣으세요
select u.name as 회원, u.phone as 연락처, p.name as 수강권, p.remaining_count as 남은_횟수,
       p.expires_on as 만료일, case when p.is_active then '사용 중' else '중지' end as 상태
  from public.studio_close_requests r
  join public.passes p on p.studio_id = r.studio_id
  join public.studio_members sm on sm.studio_id = p.studio_id and sm.user_id = p.member_id and sm.status = 'active' and sm.role <> 'owner'
  join public.users u on u.id = p.member_id and u.withdrawn_at is null
 where r.id = '여기에_요청_id'
   and p.expires_on >= (now() at time zone 'Asia/Seoul')::date
 order by p.remaining_count desc, u.name;
-- 최근 30일 안에 원장·관리자가 줄인 횟수 (있으면 실제 환불했는지 확인)
select u.name as 회원, l.delta as 변동, l.memo as 메모, to_char(l.created_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as 시각
  from public.studio_close_requests r
  join public.pass_logs l on l.studio_id = r.studio_id and l.reason in ('admin_adjust', 'deactivated') and l.created_at > now() - interval '30 days'
  join public.users u on u.id = l.member_id
 where r.id = '여기에_요청_id'
 order by l.created_at desc;


-- [3] 승인 — 바로 운영 종료됩니다 (되돌릴 수 없음). 메모는 원장에게 알림으로 전달
-- select public.admin_decide_close_request('여기에_요청_id', true, '회원 정리 확인했습니다');

-- [4] 반려 — 스튜디오는 그대로, 원장에게 사유가 알림으로 전달 (원장은 다시 요청할 수 있음)
-- select public.admin_decide_close_request('여기에_요청_id', false, '남은 회원 2명의 환불 확인이 필요합니다');


-- [5] 처리 내역
select s.name as 스튜디오, r.status as 상태, r.reason as 사유, r.decision_note as 운영자_메모,
       to_char(r.created_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as 요청,
       to_char(r.decided_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as 처리
  from public.studio_close_requests r join public.studios s on s.id = r.studio_id
 order by r.created_at desc
 limit 50;
