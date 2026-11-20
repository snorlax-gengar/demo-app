-- =============================================================================
-- 패치 015: 남은 수강권이 있는 스튜디오는 원장이 바로 운영 종료할 수 없다 → 운영자 승인
--
--  · "남은 수강권" = 만료되지 않은 수강권의 (남은 횟수 + 앞으로 확정된 예약에 쓴 횟수
--                    + 최근 30일 안에 원장·관리자가 줄인 횟수). 중지한 수강권도 포함.
--    → 수강권을 중지하거나 횟수를 0으로 줄여 놓고 닫는 우회를 막는다.
--  · 남은 수강권이 있으면 close_studio 는 거절, 대신 request_studio_close(사유) 로 요청을 남긴다.
--  · 요청이 들어오면 운영자(app_operators 에 등록된 계정)에게 앱 알림·푸시.
--  · 운영자는 SQL Editor 에서 admin_decide_close_request(요청 id, 승인 여부, 메모) 로 처리
--    (supabase/admin/close_requests.sql 참고). 승인하면 운영 종료 + 회원 알림, 원장에게 결과 알림.
--
-- 014 적용 후 Supabase SQL Editor 에서 한 번 실행. 여러 번 실행해도 안전.
-- =============================================================================

-- 1) 알림 종류 추가
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'booked_by_staff', 'waitlisted_by_staff', 'promoted', 'cancelled_by_staff', 'class_cancelled', 'reminder',
  'studio_closed', 'close_request_new', 'close_request_approved', 'close_request_rejected'));

-- 2) 운영자 계정 (앱 사용자 중 운영 종료 요청 알림을 받을 사람). 앱에서는 읽을 수 없다
create table if not exists public.app_operators (
  user_id    uuid primary key references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_operators enable row level security;
revoke all on public.app_operators from public, anon, authenticated;

-- 3) 운영 종료 요청
create table if not exists public.studio_close_requests (
  id             uuid primary key default gen_random_uuid(),
  studio_id      uuid not null references public.studios (id) on delete cascade,
  requested_by   uuid references public.users (id) on delete set null,
  reason         text not null check (char_length(btrim(reason)) between 5 and 1000),
  open_passes    jsonb not null default '{}'::jsonb,              -- 요청 시점의 남은 수강권 요약
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now()
);
create unique index if not exists studio_close_requests_one_pending
  on public.studio_close_requests (studio_id) where status = 'pending';
create index if not exists studio_close_requests_status_idx on public.studio_close_requests (status, created_at);
alter table public.studio_close_requests enable row level security;
drop policy if exists close_requests_owner_select on public.studio_close_requests;
create policy close_requests_owner_select on public.studio_close_requests
  for select to authenticated using (public.studio_role(studio_id) = 'owner');
revoke all on public.studio_close_requests from public, anon, authenticated;
grant select on public.studio_close_requests to authenticated;

-- 4) 남은 수강권 계산 (내부)
create or replace function public._studio_open_passes(p_studio_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with eff as (
    select p.id, p.member_id, u.name,
           p.remaining_count
           + (select count(*) from public.bookings b join public.classes c on c.id = b.class_id
               where b.pass_id = p.id and b.status = 'confirmed' and c.status = 'scheduled' and c.starts_at > now())
           + greatest(0, -coalesce((select sum(l.delta) from public.pass_logs l
                                     where l.pass_id = p.id and l.reason = 'admin_adjust'
                                       and l.created_at > now() - interval '30 days'), 0)) as owed
      from public.passes p
      join public.studio_members sm on sm.studio_id = p.studio_id and sm.user_id = p.member_id
                                   and sm.status = 'active' and sm.role <> 'owner'
      join public.users u on u.id = p.member_id and u.withdrawn_at is null
     where p.studio_id = p_studio_id
       and p.expires_on >= (now() at time zone 'Asia/Seoul')::date
  ), per as (
    select member_id, name, sum(owed)::int as remaining from eff where owed > 0 group by member_id, name
  )
  select jsonb_build_object(
    'members',   (select count(*) from per),
    'remaining', coalesce((select sum(remaining) from per), 0),
    'list',      coalesce((select jsonb_agg(jsonb_build_object('name', name, 'remaining', remaining) order by remaining desc, name)
                             from (select * from per order by remaining desc, name limit 20) t), '[]'::jsonb)
  );
$$;
revoke execute on function public._studio_open_passes(uuid) from public, anon, authenticated;

-- 5) 운영 종료 (원장만): 남은 수강권이 있으면 거절
create or replace function public.close_studio(p_studio_id uuid, p_confirm_name text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_name text;
  v_open jsonb;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if coalesce(public.studio_role(p_studio_id), '') <> 'owner' then
    raise exception '원장만 스튜디오 운영을 종료할 수 있습니다.';
  end if;
  v_open := public._studio_open_passes(p_studio_id);
  if (v_open->>'members')::int > 0 then
    raise exception '남은 수강권이 있는 회원이 있어 바로 종료할 수 없어요 (회원 %명 · 남은 횟수 %회). 회원과 정리한 뒤 운영 종료 요청을 보내 주세요.',
      v_open->>'members', v_open->>'remaining';
  end if;
  select name into v_name from public.studios where id = p_studio_id;
  if btrim(coalesce(p_confirm_name, '')) <> v_name then
    raise exception '스튜디오 이름이 일치하지 않습니다. "%" 를 그대로 입력해 주세요.', v_name;
  end if;
  return public._close_studio(p_studio_id, auth.uid(), true);
end;
$$;
revoke all on function public.close_studio(uuid, text) from public, anon;
grant execute on function public.close_studio(uuid, text) to authenticated;

-- 6) 미리 보기 (원장만): 남은 수강권·최근 요청 포함
create or replace function public.close_studio_preview(p_studio_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if coalesce(public.studio_role(p_studio_id), '') <> 'owner' then
    raise exception '원장만 볼 수 있습니다.';
  end if;
  return jsonb_build_object(
    'classes',  (select count(*) from public.classes where studio_id = p_studio_id and status = 'scheduled' and starts_at > now()),
    'bookings', (select count(*) from public.bookings b join public.classes c on c.id = b.class_id
                  where c.studio_id = p_studio_id and c.status = 'scheduled' and c.starts_at > now() and b.status in ('confirmed', 'waitlist')),
    'members',  (select count(*) from public.studio_members where studio_id = p_studio_id and status = 'active' and user_id <> auth.uid()),
    'open',     public._studio_open_passes(p_studio_id),
    'request',  (select jsonb_build_object('id', r.id, 'status', r.status, 'reason', r.reason, 'created_at', r.created_at,
                                           'decided_at', r.decided_at, 'decision_note', r.decision_note)
                   from public.studio_close_requests r where r.studio_id = p_studio_id
                  order by r.created_at desc limit 1)
  );
end;
$$;
revoke all on function public.close_studio_preview(uuid) from public, anon;
grant execute on function public.close_studio_preview(uuid) to authenticated;

-- 7) 운영 종료 요청 (원장만, 남은 수강권이 있을 때). 운영자에게 알림
create or replace function public.request_studio_close(p_studio_id uuid, p_reason text)
returns public.studio_close_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_studio public.studios;
  v_open   jsonb;
  v_req    public.studio_close_requests;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if coalesce(public.studio_role(p_studio_id), '') <> 'owner' then
    raise exception '원장만 운영 종료를 요청할 수 있습니다.';
  end if;
  select * into v_studio from public.studios where id = p_studio_id for update;
  if v_studio.closed_at is not null then
    raise exception '이미 운영을 종료한 스튜디오입니다.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception '요청 사유를 5자 이상 적어 주세요. (회원과 어떻게 정리했는지 등)';
  end if;
  if exists (select 1 from public.studio_close_requests where studio_id = p_studio_id and status = 'pending') then
    raise exception '이미 검토 중인 운영 종료 요청이 있어요.';
  end if;
  v_open := public._studio_open_passes(p_studio_id);
  if (v_open->>'members')::int = 0 then
    raise exception '남은 수강권이 없어 요청 없이 바로 운영을 종료할 수 있어요.';
  end if;

  insert into public.studio_close_requests (studio_id, requested_by, reason, open_passes)
  values (p_studio_id, auth.uid(), left(btrim(p_reason), 1000), v_open)
  returning * into v_req;

  insert into public.notifications (user_id, studio_id, kind, title, body, data)
  select o.user_id, p_studio_id, 'close_request_new', '운영 종료 요청 · ' || v_studio.name,
         v_studio.name || ' 원장이 운영 종료를 요청했어요. 남은 수강권: 회원 ' || (v_open->>'members') || '명 · '
           || (v_open->>'remaining') || '회' || E'\n' || '사유: ' || left(btrim(p_reason), 200),
         jsonb_build_object('path', '/notifications', 'request_id', v_req.id)
    from public.app_operators o;

  return v_req;
end;
$$;
revoke all on function public.request_studio_close(uuid, text) from public, anon;
grant execute on function public.request_studio_close(uuid, text) to authenticated;

-- 8) 요청 취소 (원장만, 검토 중일 때)
create or replace function public.cancel_studio_close_request(p_request_id uuid)
returns public.studio_close_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_req public.studio_close_requests;
begin
  select * into v_req from public.studio_close_requests where id = p_request_id for update;
  if not found or coalesce(public.studio_role(v_req.studio_id), '') <> 'owner' then
    raise exception '원장만 요청을 취소할 수 있습니다.';
  end if;
  if v_req.status <> 'pending' then
    raise exception '검토 중인 요청만 취소할 수 있어요.';
  end if;
  update public.studio_close_requests set status = 'cancelled', decided_at = now() where id = p_request_id returning * into v_req;
  return v_req;
end;
$$;
revoke all on function public.cancel_studio_close_request(uuid) from public, anon;
grant execute on function public.cancel_studio_close_request(uuid) to authenticated;

-- 9) 운영자 처리 (SQL Editor 전용: 앱 사용자는 실행할 수 없다)
create or replace function public.admin_decide_close_request(p_request_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_req    public.studio_close_requests;
  v_studio public.studios;
  v_result jsonb := '{}'::jsonb;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into v_req from public.studio_close_requests where id = p_request_id for update;
  if not found then
    raise exception '요청을 찾을 수 없습니다.';
  end if;
  if v_req.status <> 'pending' then
    raise exception '이미 처리된 요청입니다 (%).', v_req.status;
  end if;
  select * into v_studio from public.studios where id = v_req.studio_id;

  if p_approve then
    v_result := public._close_studio(v_req.studio_id, v_req.requested_by, true);
  end if;
  update public.studio_close_requests
     set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now(), decision_note = v_note
   where id = p_request_id;

  if v_req.requested_by is not null then
    insert into public.notifications (user_id, studio_id, kind, title, body, data)
    values (v_req.requested_by, v_req.studio_id,
            case when p_approve then 'close_request_approved' else 'close_request_rejected' end,
            case when p_approve then '운영 종료 요청이 승인됐어요' else '운영 종료 요청이 반려됐어요' end,
            case when p_approve
                 then v_studio.name || ' 운영을 종료했어요. 회원들에게 종료 알림을 보냈어요.'
                 else v_studio.name || ' 운영 종료 요청이 반려됐어요.' end
              || coalesce(E'\n' || '운영자 메모: ' || v_note, ''),
            jsonb_build_object('path', '/notifications', 'request_id', p_request_id));
  end if;

  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end) || v_result;
end;
$$;
revoke all on function public.admin_decide_close_request(uuid, boolean, text) from public, anon, authenticated;
