-- =============================================================================
-- 패치 003 — 수강권 관리 + 원장 여러 명
-- v2 schema.sql 을 이미 실행한 DB 에 1회 실행하세요. (새로 설치하면 schema.sql 에 포함돼 있습니다)
--
--   1. 원장(owner)을 여러 명 둘 수 있다. 원장 지정·해제는 원장만. 본인 역할은 못 바꾸므로 원장 0명은 불가
--   2. 수강권 발급·기간 연장·횟수 조정·사용 중지/재개를 전용 함수로만 (변동 내역에 전부 기록)
--   3. 발급 시 결제 금액 기록(선택) → pass_payments. 원장만 조회 가능 (추후 매출 화면용)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. 원장 여러 명 허용
-- -----------------------------------------------------------------------------
drop index if exists public.studio_members_one_owner;

create or replace function public.set_member_role(
  p_studio_id uuid,
  p_user_id   uuid,
  p_role      text
)
returns public.studio_members
language plpgsql security definer set search_path = public
as $$
declare
  v_my_role text := public.studio_role(p_studio_id);
  v_target  public.studio_members;
begin
  if v_my_role is null or v_my_role not in ('owner', 'manager') then
    raise exception '원장 또는 관리자만 역할을 바꿀 수 있습니다.';
  end if;
  if p_role not in ('owner', 'manager', 'instructor', 'member') then
    raise exception '지정할 수 없는 역할입니다: %', p_role;
  end if;
  -- 본인 변경 금지 → 원장이 스스로 내려가 원장이 0명이 되는 일이 없다
  if p_user_id = auth.uid() then
    raise exception '본인의 역할은 바꿀 수 없습니다.';
  end if;

  select * into v_target from public.studio_members
   where studio_id = p_studio_id and user_id = p_user_id and status = 'active'
     for update;
  if not found then
    raise exception '이 스튜디오에 소속된 사람이 아닙니다.';
  end if;
  if (p_role in ('owner', 'manager') or v_target.role in ('owner', 'manager')) and v_my_role <> 'owner' then
    raise exception '원장·관리자 지정과 해제는 원장만 할 수 있습니다.';
  end if;

  if p_role = 'member' and v_target.role <> 'member' and exists (
    select 1 from public.classes
     where studio_id = p_studio_id and instructor_id = p_user_id
       and status = 'scheduled' and starts_at > now()
  ) then
    raise exception '예정된 담당 수업이 있어 회원으로 바꿀 수 없습니다. 수업 담당자를 먼저 바꾸거나 폐강해 주세요.';
  end if;

  update public.studio_members set role = p_role
   where studio_id = p_studio_id and user_id = p_user_id
  returning * into v_target;
  return v_target;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. 변동 내역 사유 추가 + 결제 기록 테이블
-- -----------------------------------------------------------------------------
alter table public.pass_logs drop constraint if exists pass_logs_reason_check;
alter table public.pass_logs add constraint pass_logs_reason_check check (reason in (
  'issued', 'booking', 'waitlist_promotion', 'cancel_refund', 'class_cancelled', 'admin_adjust',
  'extended', 'deactivated', 'reactivated'
));

create table if not exists public.pass_payments (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references public.studios (id) on delete cascade,
  pass_id     uuid not null references public.passes (id) on delete cascade,
  member_id   uuid not null references public.users (id) on delete cascade,
  amount      int  not null check (amount >= 0),
  method      text not null default 'card' check (method in ('card', 'cash', 'transfer', 'other')),
  paid_on     date not null default current_date,
  memo        text,
  created_by  uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists pass_payments_studio_idx on public.pass_payments (studio_id, paid_on desc);
create index if not exists pass_payments_pass_idx   on public.pass_payments (pass_id);

alter table public.pass_payments enable row level security;
drop policy if exists pass_payments_owner_select on public.pass_payments;
create policy pass_payments_owner_select on public.pass_payments
  for select to authenticated using (public.studio_role(studio_id) = 'owner');

revoke all on public.pass_payments from anon, authenticated;
grant select on public.pass_payments to authenticated;

-- -----------------------------------------------------------------------------
-- 3. 수강권은 함수로만 변경 (직접 INSERT/UPDATE 차단 → 변동 내역 누락 방지)
-- -----------------------------------------------------------------------------
drop policy if exists passes_admin_insert on public.passes;
drop policy if exists passes_admin_update on public.passes;
revoke insert, update on public.passes from authenticated;

-- 3-1. 발급 (원장·관리자). 결제 금액은 선택
create or replace function public.issue_pass(
  p_studio_id  uuid,
  p_member_id  uuid,
  p_class_type text,
  p_name       text,
  p_total      int,
  p_starts_on  date,
  p_expires_on date,
  p_amount     int  default null,
  p_method     text default null,
  p_memo       text default null
)
returns public.passes
language plpgsql security definer set search_path = public
as $$
declare
  v_pass public.passes;
begin
  if not public.is_studio_admin(p_studio_id) then
    raise exception '원장 또는 관리자만 수강권을 발급할 수 있습니다.';
  end if;
  if not exists (
    select 1 from public.studio_members
     where studio_id = p_studio_id and user_id = p_member_id and status = 'active' and role = 'member'
  ) then
    raise exception '이 스튜디오의 회원에게만 발급할 수 있습니다.';
  end if;
  if p_class_type not in ('private', 'group') then
    raise exception '수강권 유형이 올바르지 않습니다.';
  end if;
  if p_total is null or p_total < 1 or p_total > 500 then
    raise exception '횟수는 1~500회 사이로 입력해 주세요.';
  end if;
  if p_starts_on is null or p_expires_on is null or p_expires_on < p_starts_on then
    raise exception '만료일은 시작일 이후여야 합니다.';
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception '결제 금액이 올바르지 않습니다.';
  end if;

  insert into public.passes (studio_id, member_id, class_type, name, total_count, remaining_count, starts_on, expires_on)
  values (p_studio_id, p_member_id, p_class_type, coalesce(nullif(btrim(p_name), ''), '수강권'), p_total, p_total, p_starts_on, p_expires_on)
  returning * into v_pass;  -- 'issued' 내역은 트리거가 기록

  if nullif(btrim(coalesce(p_memo, '')), '') is not null then
    update public.pass_logs set memo = btrim(p_memo) where pass_id = v_pass.id and reason = 'issued';
  end if;

  if p_amount is not null then
    insert into public.pass_payments (studio_id, pass_id, member_id, amount, method, memo, created_by)
    values (p_studio_id, v_pass.id, p_member_id, p_amount, coalesce(p_method, 'card'), nullif(btrim(coalesce(p_memo, '')), ''), auth.uid());
  end if;

  return v_pass;
end;
$$;

-- 3-2. 기간 연장/단축 (홀딩·보상). 음수면 단축
create or replace function public.extend_pass(
  p_pass_id uuid,
  p_days    int,
  p_memo    text default null
)
returns public.passes
language plpgsql security definer set search_path = public
as $$
declare
  v_pass   public.passes;
  v_before date;
begin
  select * into v_pass from public.passes where id = p_pass_id for update;
  if not found or not public.is_studio_admin(v_pass.studio_id) then
    raise exception '원장 또는 관리자만 수강권 기간을 바꿀 수 있습니다.';
  end if;
  if p_days is null or p_days = 0 or abs(p_days) > 730 then
    raise exception '변경할 일수가 올바르지 않습니다.';
  end if;
  if v_pass.expires_on + p_days < v_pass.starts_on then
    raise exception '만료일이 시작일보다 앞설 수 없습니다.';
  end if;

  v_before := v_pass.expires_on;
  update public.passes set expires_on = expires_on + p_days where id = p_pass_id returning * into v_pass;

  insert into public.pass_logs (studio_id, pass_id, member_id, delta, remaining_after, reason, memo, actor_id)
  values (v_pass.studio_id, v_pass.id, v_pass.member_id, 0, v_pass.remaining_count, 'extended',
          concat_ws(' · ',
            format('%s일 %s (만료 %s → %s)', abs(p_days), case when p_days > 0 then '연장' else '단축' end,
                   to_char(v_before, 'YYYY.MM.DD'), to_char(v_pass.expires_on, 'YYYY.MM.DD')),
            nullif(btrim(coalesce(p_memo, '')), '')),
          auth.uid());
  return v_pass;
end;
$$;

-- 3-3. 사용 중지 / 재개 (환불·양도 등). 중지된 수강권은 새 예약에 쓰이지 않는다(기존 예약은 유지)
create or replace function public.set_pass_active(
  p_pass_id uuid,
  p_active  boolean,
  p_memo    text default null
)
returns public.passes
language plpgsql security definer set search_path = public
as $$
declare
  v_pass public.passes;
begin
  select * into v_pass from public.passes where id = p_pass_id for update;
  if not found or not public.is_studio_admin(v_pass.studio_id) then
    raise exception '원장 또는 관리자만 수강권을 중지·재개할 수 있습니다.';
  end if;
  if v_pass.is_active = p_active then
    return v_pass;
  end if;

  update public.passes set is_active = p_active where id = p_pass_id returning * into v_pass;
  insert into public.pass_logs (studio_id, pass_id, member_id, delta, remaining_after, reason, memo, actor_id)
  values (v_pass.studio_id, v_pass.id, v_pass.member_id, 0, v_pass.remaining_count,
          case when p_active then 'reactivated' else 'deactivated' end,
          nullif(btrim(coalesce(p_memo, '')), ''), auth.uid());
  return v_pass;
end;
$$;

-- 3-4. 횟수 조정 (보상 +1, 오차 정정 등). 총 횟수를 넘겨 늘리면 총 횟수도 함께 늘린다
create or replace function public.admin_adjust_pass(
  p_pass_id uuid,
  p_delta   int,
  p_memo    text default null
)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_pass public.passes;
begin
  select * into v_pass from public.passes where id = p_pass_id for update;
  if not found or not public.is_studio_admin(v_pass.studio_id) then
    raise exception '원장 또는 관리자만 수강권을 조정할 수 있습니다.';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 500 then
    raise exception '조정할 횟수가 올바르지 않습니다.';
  end if;
  if v_pass.remaining_count + p_delta < 0 then
    raise exception '남은 횟수(%회)보다 많이 줄일 수 없습니다.', v_pass.remaining_count;
  end if;
  if v_pass.remaining_count + p_delta > v_pass.total_count then
    update public.passes set total_count = remaining_count + p_delta where id = p_pass_id;
  end if;
  return public._apply_pass_delta(p_pass_id, p_delta, 'admin_adjust', null, nullif(btrim(coalesce(p_memo, '')), ''));
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. 실행 권한
-- -----------------------------------------------------------------------------
revoke execute on function public.issue_pass(uuid, uuid, text, text, int, date, date, int, text, text) from public, anon;
revoke execute on function public.extend_pass(uuid, int, text)                                         from public, anon;
revoke execute on function public.set_pass_active(uuid, boolean, text)                                 from public, anon;
grant  execute on function public.issue_pass(uuid, uuid, text, text, int, date, date, int, text, text) to authenticated;
grant  execute on function public.extend_pass(uuid, int, text)                                         to authenticated;
grant  execute on function public.set_pass_active(uuid, boolean, text)                                 to authenticated;
