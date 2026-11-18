-- =============================================================================
-- 010: 알림 (알림함 + 휴대폰 푸시)
-- -----------------------------------------------------------------------------
-- 회원에게 알림이 쌓이는 경우 (회원 본인이 한 일은 제외):
--   · 직원이 대신 예약/대기 신청    · 대기에서 자동 확정    · 직원이 예약/대기 취소
--   · 폐강                          · 수업 전날 20:00 (pg_cron 이 켜져 있을 때)
-- 앱 '알림' 화면에 바로 보이고, Edge Function send-push 를 연결하면 휴대폰으로도 간다.
-- 실행: Supabase SQL Editor 에서 이 파일 전체를 한 번 실행. (다시 실행해도 안전)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 10-2. 알림 — 알림함(notifications) + 휴대폰 푸시 토큰(push_tokens)
--   · 예약 이벤트가 생기면 트리거가 notifications 에 한 줄을 쌓는다 (본인이 한 일은 알리지 않음)
--   · 앱의 '알림' 화면은 이 표를 그대로 보여주고, Edge Function send-push 가 아직 안 보낸 줄을 휴대폰으로 보낸다
-- -----------------------------------------------------------------------------
create table if not exists public.push_tokens (
  token       text primary key check (token ~ '^Expo(nent)?PushToken\[.+\]$'),
  user_id     uuid not null references public.users (id) on delete cascade,
  platform    text not null default 'unknown' check (platform in ('ios', 'android', 'web', 'unknown')),
  updated_at  timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

create table if not exists public.notifications (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.users (id) on delete cascade,
  studio_id     uuid references public.studios (id) on delete cascade,
  kind          text not null check (kind in ('booked_by_staff', 'waitlisted_by_staff', 'promoted', 'cancelled_by_staff', 'class_cancelled', 'reminder')),
  title         text not null,
  body          text not null,
  data          jsonb not null default '{}'::jsonb,
  booking_id    uuid references public.bookings (id) on delete set null,
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  push_sent_at  timestamptz,
  push_error    text
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unsent_idx on public.notifications (created_at) where push_sent_at is null;
-- 전날 알림은 예약당 한 번만
create unique index if not exists notifications_reminder_once on public.notifications (booking_id) where kind = 'reminder';

alter table public.push_tokens   enable row level security;
alter table public.notifications enable row level security;
drop policy if exists notifications_own_select on public.notifications;
create policy notifications_own_select on public.notifications
  for select to authenticated using (user_id = auth.uid());

revoke all on public.push_tokens, public.notifications from anon, authenticated, public;
grant select on public.notifications to authenticated;

-- '11월 19일 (목) 19:00' (한국 시간)
create or replace function public._kst_label(p_at timestamptz)
returns text language sql immutable set search_path = public as $$
  select to_char(p_at at time zone 'Asia/Seoul', 'FMMM"월" FMDD"일" (')
      || (array['일','월','화','수','목','금','토'])[extract(dow from p_at at time zone 'Asia/Seoul')::int + 1]
      || ') ' || to_char(p_at at time zone 'Asia/Seoul', 'HH24:MI');
$$;

create or replace function public._notify(
  p_user uuid, p_studio uuid, p_kind text, p_title text, p_body text, p_booking uuid, p_data jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, studio_id, kind, title, body, booking_id, data)
  values (p_user, p_studio, p_kind, p_title, p_body, p_booking,
          coalesce(p_data, '{}'::jsonb) || jsonb_build_object('path', '/', 'booking_id', p_booking, 'studio_id', p_studio))
  on conflict do nothing;
$$;

-- 예약 이벤트 → 알림. 회원 본인이 한 예약·취소는 알리지 않는다
create or replace function public.trg_booking_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_class  public.classes;
  v_studio text;
  v_when   text;
  v_actor  uuid := auth.uid();
  v_pos    int;
begin
  select * into v_class from public.classes where id = new.class_id;
  select name into v_studio from public.studios where id = new.studio_id;
  v_when := public._kst_label(v_class.starts_at) || ' ' || v_class.title;

  if tg_op = 'INSERT' then
    if v_actor is distinct from new.member_id then
      if new.status = 'confirmed' then
        perform public._notify(new.member_id, new.studio_id, 'booked_by_staff', '예약이 확정됐어요',
          v_when || E'\n' || v_studio || '에서 대신 예약했어요. 수강권 1회가 차감됐어요.', new.id);
      elsif new.status = 'waitlist' then
        select count(*) into v_pos from public.bookings where class_id = new.class_id and status = 'waitlist' and created_at <= new.created_at;
        perform public._notify(new.member_id, new.studio_id, 'waitlisted_by_staff', '대기 신청이 등록됐어요',
          v_when || E'\n' || v_studio || '에서 대신 신청했어요. 대기 ' || v_pos || '번 · 자리가 나면 자동으로 확정돼요.', new.id);
      end if;
    end if;
    return null;
  end if;

  -- 대기 → 확정 (자동 승격)
  if old.status = 'waitlist' and new.status = 'confirmed' then
    perform public._notify(new.member_id, new.studio_id, 'promoted', '대기에서 예약이 확정됐어요',
      v_when || E'\n' || '자리가 나서 자동으로 확정됐어요. 수강권 1회가 차감됐어요.', new.id);
  -- 취소: 폐강 / 직원이 대신 취소
  elsif old.status in ('confirmed', 'waitlist') and new.status = 'cancelled'
        and new.cancelled_by is distinct from new.member_id then
    if v_class.status = 'cancelled' then
      perform public._notify(new.member_id, new.studio_id, 'class_cancelled', '수업이 폐강됐어요',
        v_when || E'\n' || case when old.status = 'confirmed' and new.pass_refunded then '수강권 1회가 복구됐어요.'
                                when old.status = 'waitlist' then '대기 신청도 함께 취소됐어요.'
                                else '' end, new.id);
    else
      perform public._notify(new.member_id, new.studio_id, 'cancelled_by_staff',
        case when old.status = 'waitlist' then '대기 신청이 취소됐어요' else '예약이 취소됐어요' end,
        v_when || E'\n' || v_studio || '에서 취소했어요. '
          || case when old.status = 'waitlist' then '' when new.pass_refunded then '수강권 1회가 복구됐어요.' else '수강권 횟수는 복구되지 않았어요.' end,
        new.id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists bookings_notify_insert on public.bookings;
drop trigger if exists bookings_notify_update on public.bookings;
create trigger bookings_notify_insert
  after insert on public.bookings
  for each row execute function public.trg_booking_notify();
create trigger bookings_notify_update
  after update of status on public.bookings
  for each row when (old.status is distinct from new.status)
  execute function public.trg_booking_notify();

-- 전날 알림: p_day(한국 날짜, 기본 내일)에 시작하는 확정 예약마다 1번. pg_cron 으로 매일 20:00(KST) 실행
create or replace function public.enqueue_class_reminders(p_day date default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'Asia/Seoul')::date + 1);
  v_count int;
begin
  with ins as (
    insert into public.notifications (user_id, studio_id, kind, title, body, booking_id, data)
    select b.member_id, b.studio_id, 'reminder',
           case when v_day = (now() at time zone 'Asia/Seoul')::date + 1 then '내일 수업이 있어요' else '수업 알림' end,
           public._kst_label(c.starts_at) || ' ' || c.title
             || coalesce(' · ' || nullif(c.location, ''), '') || E'\n' || s.name
             || ' · 못 오시면 24시간 전까지 앱에서 취소해 주세요.',
           b.id, jsonb_build_object('path', '/', 'booking_id', b.id, 'studio_id', b.studio_id)
      from public.bookings b
      join public.classes c on c.id = b.class_id
      join public.studios s on s.id = b.studio_id
     where b.status = 'confirmed' and c.status = 'scheduled'
       and (c.starts_at at time zone 'Asia/Seoul')::date = v_day
    on conflict do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end;
$$;

-- 앱: 이 기기의 푸시 토큰 등록/해제, 알림 읽음 처리
create or replace function public.register_push_token(p_token text, p_platform text default 'unknown')
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.'; end if;
  if p_token !~ '^Expo(nent)?PushToken\[.+\]$' then raise exception '푸시 토큰 형식이 올바르지 않습니다.'; end if;
  -- 같은 기기에서 다른 계정으로 로그인하면 토큰 주인을 바꾼다
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), case when p_platform in ('ios', 'android', 'web') then p_platform else 'unknown' end, now())
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

create or replace function public.unregister_push_token(p_token text)
returns void
language sql security definer set search_path = public as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;

create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_count int;
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public._kst_label(timestamptz) from public, anon, authenticated;
revoke execute on function public._notify(uuid, uuid, text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.trg_booking_notify() from public, anon, authenticated;
revoke execute on function public.enqueue_class_reminders(date) from public, anon, authenticated;
revoke execute on function public.register_push_token(text, text) from public, anon;
revoke execute on function public.unregister_push_token(text) from public, anon;
revoke execute on function public.mark_notifications_read(bigint[]) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;
grant execute on function public.mark_notifications_read(bigint[]) to authenticated;


-- 전날 알림 예약 (Database → Extensions 에서 pg_cron 을 켠 경우에만). 매일 11:00 UTC = 20:00 KST
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'class-reminders';
    perform cron.schedule('class-reminders', '0 11 * * *', 'select public.enqueue_class_reminders()');
    raise notice '전날 알림 예약 완료 (매일 20:00 KST)';
  else
    raise notice 'pg_cron 이 꺼져 있어 전날 알림은 예약하지 않았습니다. 켠 뒤 이 파일을 다시 실행하세요.';
  end if;
end $$;
