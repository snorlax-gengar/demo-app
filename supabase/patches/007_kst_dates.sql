-- =============================================================================
-- 007: 결제일·수강권 시작일 기본값을 한국 날짜로
-- -----------------------------------------------------------------------------
-- 문제: 기본값 current_date 는 DB 서버 시간대(Supabase = UTC) 기준이라
--       한국 시간 00:00~08:59 에 발급·결제하면 전날 날짜로 기록된다 → 매출 화면의 일·월 집계가 어긋남.
-- 수정: 기본값을 (now() at time zone 'Asia/Seoul')::date 로 바꾼다.
--       이미 저장된 결제일은 created_at 의 한국 날짜로 다시 맞춘다(기본값으로 들어간 행만).
-- 실행: Supabase SQL Editor 에서 이 파일 전체를 한 번 실행.
-- =============================================================================

alter table public.pass_payments alter column paid_on   set default ((now() at time zone 'Asia/Seoul')::date);
alter table public.passes        alter column starts_on set default ((now() at time zone 'Asia/Seoul')::date);

-- 지금까지는 결제일을 따로 입력하는 화면이 없어 모두 기본값으로 저장됐다 → 생성 시각의 한국 날짜로 보정
update public.pass_payments
   set paid_on = (created_at at time zone 'Asia/Seoul')::date
 where paid_on = (created_at at time zone 'UTC')::date
   and paid_on <> (created_at at time zone 'Asia/Seoul')::date;
