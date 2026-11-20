-- 018: 초대 코드 무작위 대입 막기 (2026-11-20 출시 전 보안 점검 S-03)
-- 여러 번 실행해도 안전하다.

-- 초대 코드 맞히기(무작위 대입) 막기: 틀린 시도를 기록하고, 1시간에 10번 넘게 틀리면 잠시 막는다
create table if not exists public.join_attempts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists join_attempts_user_time_idx on public.join_attempts (user_id, created_at);
create index if not exists join_attempts_time_idx on public.join_attempts (created_at);
alter table public.join_attempts enable row level security;   -- 정책 없음: 앱에서 직접 읽기·쓰기 불가
revoke all on public.join_attempts from anon, authenticated;

-- 틀린 코드면 예외 대신 빈 결과(id = null)를 돌려준다. 예외를 던지면 시도 기록까지 되돌려져 횟수를 셀 수 없기 때문.
-- 앱은 id 가 없으면 "초대 코드를 찾을 수 없습니다" 를 보여 준다.
create or replace function public.join_studio(p_code text)
returns public.studios
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_code   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_studio public.studios;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if (select count(*) from public.join_attempts where user_id = v_uid and created_at > now() - interval '1 hour') >= 10
     or (select count(*) from public.join_attempts where created_at > now() - interval '10 minutes') >= 300 then
    raise exception '초대 코드를 너무 많이 틀렸어요. 1시간 뒤에 다시 시도하거나, 스튜디오에 코드를 다시 확인해 주세요.';
  end if;

  select * into v_studio from public.studios where invite_code = v_code;
  if not found then
    insert into public.join_attempts (user_id) values (v_uid);
    return null;
  end if;

  insert into public.studio_members (studio_id, user_id, role)
  values (v_studio.id, v_uid, 'member')
  on conflict (studio_id, user_id) do update
    set status = 'active'
  where public.studio_members.status = 'left';

  return v_studio;
end;
$$;
revoke all on function public.join_studio(text) from public, anon;
grant execute on function public.join_studio(text) to authenticated;

-- 하루 지난 시도 기록은 지운다 (send-push-retry 와 같은 pg_cron 이 있을 때만)
create or replace function public.purge_old_join_attempts()
returns void language sql security definer set search_path = public
as $$ delete from public.join_attempts where created_at < now() - interval '1 day'; $$;
revoke all on function public.purge_old_join_attempts() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge-join-attempts';
    perform cron.schedule('purge-join-attempts', '40 18 * * *', 'select public.purge_old_join_attempts()');
  end if;
end $$;
