-- =============================================================================
-- 011: 알림이 쌓이면 휴대폰 푸시 발송 함수(send-push) 자동 호출
-- -----------------------------------------------------------------------------
-- Database → Webhooks 화면 대신, SQL 로 연결한다. (010 을 먼저 실행)
--
-- ▶ 실행 전에 아래쪽 '여기에_프로젝트_ref' (한 곳) 를 바꾸세요.
--   .env 의 EXPO_PUBLIC_SUPABASE_URL = https://<ref>.supabase.co  → <ref> 부분
-- ▶ send-push 함수는 --no-verify-jwt 로 배포해야 이 호출이 통과합니다 (docs/push-setup.md 4단계)
-- 다시 실행해도 안전합니다.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 10-3. 알림이 쌓이면 Edge Function send-push 호출 (pg_net). Database Webhook 대신 SQL 로 연결
--   · 함수 주소는 app_settings('send_push_url') 에 저장 (패치 011 실행 시 입력)
--   · 한 번의 INSERT 문(예: 폐강으로 여러 명)에 호출 1번. 함수는 여러 번 불려도 같은 알림을 한 번만 보낸다
-- -----------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_net;   -- Supabase 에 기본 포함
exception when others then
  raise notice 'pg_net 을 켤 수 없어 푸시 자동 호출은 건너뜁니다: %', sqlerrm;
end $$;

create table if not exists public.app_settings (
  key    text primary key,
  value  text not null
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated, public;

create or replace function public._call_send_push()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_url    text := (select value from public.app_settings where key = 'send_push_url');
  v_secret text := (select value from public.app_settings where key = 'send_push_secret');
begin
  if v_url is null or v_url = '' then
    return; -- 아직 설정 전: 알림함에만 쌓인다
  end if;
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', coalesce(v_secret, '')),
    body    := '{}'::jsonb
  );
exception when others then
  -- 호출 실패가 예약·취소 자체를 막으면 안 된다
  raise warning 'send-push 호출 실패: %', sqlerrm;
end;
$$;

create or replace function public.trg_notifications_push()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public._call_send_push();
  return null;
end;
$$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push
  after insert on public.notifications
  for each statement execute function public.trg_notifications_push();

revoke execute on function public._call_send_push() from public, anon, authenticated;
revoke execute on function public.trg_notifications_push() from public, anon, authenticated;


do $$
declare
  v_url text := 'https://여기에_프로젝트_ref.supabase.co/functions/v1/send-push';   -- ← 여기만 바꾸세요
begin
  if v_url like '%여기에_프로젝트_ref%' then
    raise exception '011 패치 위쪽의 "여기에_프로젝트_ref" 를 실제 프로젝트 ref 로 바꾼 뒤 다시 실행하세요.';
  end if;
  insert into public.app_settings (key, value) values ('send_push_url', v_url)
  on conflict (key) do update set value = excluded.value;
end $$;

-- 혹시 놓친 알림을 5분마다 다시 확인 (pg_cron 이 켜져 있을 때)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'send-push-retry';
    perform cron.schedule('send-push-retry', '*/5 * * * *', 'select public._call_send_push()');
  end if;
end $$;

-- 확인: 주소가 제대로 들어갔는지
select key, value from public.app_settings where key = 'send_push_url';
