-- =============================================================================
-- v1(단일 스튜디오) 스키마 제거 — v2 schema.sql 을 실행하기 "전에" 1회 실행
--
--  ⚠ 이 앱이 만든 테이블의 데이터(수업·수강권·예약·프로필)가 모두 삭제됩니다.
--    지금은 테스트 데이터뿐이라는 전제입니다.
--  ✔ 로그인 계정(auth.users)은 지우지 않습니다. v2 schema.sql 이 프로필을 다시 채웁니다.
--  ✔ 이 앱이 만든 객체만 이름으로 지정해 지웁니다. 같은 프로젝트의 다른 테이블은 건드리지 않습니다.
-- =============================================================================

drop trigger if exists on_auth_user_created on auth.users;

drop view  if exists public.class_overview;

drop table if exists public.pass_logs      cascade;
drop table if exists public.bookings       cascade;
drop table if exists public.classes        cascade;
drop table if exists public.passes         cascade;
drop table if exists public.studio_members cascade;
drop table if exists public.studios        cascade;
drop table if exists public.users          cascade;

drop function if exists public.my_role()                                         cascade;
drop function if exists public.is_staff()                                        cascade;
drop function if exists public.handle_new_user()                                 cascade;
drop function if exists public.protect_user_columns()                            cascade;
drop function if exists public.touch_updated_at()                                cascade;
drop function if exists public.log_pass_issued()                                 cascade;
drop function if exists public.guard_class_update()                              cascade;
drop function if exists public._apply_pass_delta(uuid, int, text, uuid, text)    cascade;
drop function if exists public._find_usable_pass(uuid, text, timestamptz)        cascade;
drop function if exists public._promote_waitlist(uuid)                           cascade;
drop function if exists public.trg_booking_cancelled_promote()                   cascade;
drop function if exists public.trg_class_capacity_promote()                      cascade;
drop function if exists public.book_class(uuid, uuid)                            cascade;
drop function if exists public.cancel_booking(uuid, boolean)                     cascade;
drop function if exists public.mark_attendance(uuid, text)                       cascade;
drop function if exists public.cancel_class(uuid)                                cascade;
drop function if exists public.admin_adjust_pass(uuid, int, text)                cascade;
