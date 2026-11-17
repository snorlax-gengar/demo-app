-- =============================================================================
-- 테스트 데이터 정리 — 01_test_accounts.sql 과 앱 테스트로 생긴 데이터를 지웁니다
--
-- 지우는 것
--   · 제목이 '[테스트]' 로 시작하는 수업 (그 수업의 예약 포함)
--   · 이름이 '[테스트]' 로 시작하는 수강권 (변동 내역·결제 기록 포함)
--   · test.*@example.com 테스트 계정 7개 (소속·프로필 포함)
-- 지우지 않는 것
--   · 본인 계정들, 스튜디오, '[테스트]' 표시가 없는 수업·수강권
-- =============================================================================

-- 1) [테스트] 수업 (예약은 함께 삭제됨)
delete from public.classes where title like '[테스트]%';

-- 2) [테스트] 수강권
delete from public.passes where name like '[테스트]%';

-- 3) 테스트 계정 (public.users·studio_members 등은 연쇄 삭제)
delete from public.classes
 where instructor_id in (select id from auth.users where email like 'test.%@example.com');
delete from auth.users where email like 'test.%@example.com';

-- 확인: 모두 0 이어야 합니다
select
  (select count(*) from public.classes where title like '[테스트]%')                 as test_classes,
  (select count(*) from public.passes  where name  like '[테스트]%')                 as test_passes,
  (select count(*) from auth.users     where email like 'test.%@example.com')        as test_accounts;
