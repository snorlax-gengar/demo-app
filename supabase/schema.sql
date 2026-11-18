-- =============================================================================
-- 스튜디오 예약 앱 — Supabase(PostgreSQL) 전체 스키마 v2 (멀티 스튜디오)
-- 실행: Supabase Dashboard > SQL Editor 에 전체 붙여넣고 1회 실행
--   ※ v1 스키마를 이미 실행했다면 먼저 supabase/patches/000_drop_v1.sql 을 실행하세요.
--
-- 구조
--   users           : 로그인 계정의 프로필 (역할 없음)
--   studios         : 스튜디오 / 과외 선생님 개인 공간. 초대 코드 보유
--   studio_members  : 누가 어느 스튜디오에 어떤 역할로 속하는지 (한 사람이 여러 스튜디오 가능)
--                     역할: owner(원장·사장, 여러 명 가능) / manager(관리자) / instructor(강사) / member(회원)
--   passes / classes / bookings / pass_logs / pass_payments : 전부 studio_id 를 가진다
--   pass_payments   : 수강권 결제 기록. 원장만 조회 (매출용)
--
-- 설계 원칙
--   1. 권한은 전부 "그 스튜디오에서의 내 역할"로 판단 (RLS + RPC 내부 검사).
--      다른 스튜디오의 데이터는 어떤 역할이든 보이지 않는다.
--   2. 예약/취소/출석/역할 변경 등 민감한 쓰기는 SECURITY DEFINER 함수(RPC)로만.
--   3. 같은 수업에 대한 예약·취소는 classes 행을 FOR UPDATE 로 잠가 직렬화.
--   4. 수강권 횟수 변경은 _apply_pass_delta() 한 곳만 통과 → pass_logs 에 100% 기록.
--   5. max_capacity = 1 → 1:1(private), 2 이상 → 그룹(group).
-- =============================================================================

create extension if not exists btree_gist with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. 테이블
-- -----------------------------------------------------------------------------

-- 1-1. users : auth.users 와 1:1 프로필
create table public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null default '',
  phone       text,
  email       text,
  created_at  timestamptz not null default now()
);

-- 1-2. studios : 스튜디오(또는 과외 선생님 1인 공간)
create table public.studios (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 1 and 40),
  invite_code  text not null unique check (invite_code ~ '^[A-Z0-9]{6}$'),
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

-- 1-3. studio_members : 소속 + 스튜디오별 역할
create table public.studio_members (
  studio_id  uuid not null references public.studios (id) on delete cascade,
  user_id    uuid not null references public.users (id) on delete cascade,
  role       text not null default 'member'
             check (role in ('owner', 'manager', 'instructor', 'member')),
  status     text not null default 'active' check (status in ('active', 'left')),
  memo       text,                                -- 스튜디오가 남기는 회원 메모(부상 이력 등)
  joined_at  timestamptz not null default now(),
  primary key (studio_id, user_id)
);
-- 원장은 여러 명 가능. 본인 역할 변경 금지(set_member_role)로 원장 0명은 생기지 않는다
create index studio_members_user_idx on public.studio_members (user_id);

-- 1-4. passes : 수강권
create table public.passes (
  id               uuid primary key default gen_random_uuid(),
  studio_id        uuid not null references public.studios (id) on delete cascade,
  member_id        uuid not null
                   constraint passes_member_id_fkey references public.users (id) on delete cascade,
  class_type       text not null check (class_type in ('private', 'group')),
  name             text not null,
  total_count      int  not null check (total_count > 0),
  remaining_count  int  not null check (remaining_count >= 0),
  starts_on        date not null default ((now() at time zone 'Asia/Seoul')::date),
  expires_on       date not null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  constraint passes_remaining_lte_total check (remaining_count <= total_count),
  constraint passes_period_valid        check (expires_on >= starts_on),
  -- 수강권은 그 스튜디오 소속 회원에게만 발급 가능
  constraint passes_membership_fkey foreign key (studio_id, member_id)
    references public.studio_members (studio_id, user_id) on delete cascade
);
create index passes_member_idx on public.passes (studio_id, member_id, class_type, expires_on);

-- 1-5. classes : 수업(슬롯)
create table public.classes (
  id             uuid primary key default gen_random_uuid(),
  studio_id      uuid not null references public.studios (id) on delete cascade,
  title          text not null,
  instructor_id  uuid not null
                 constraint classes_instructor_id_fkey references public.users (id) on delete restrict,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  max_capacity   int  not null default 4 check (max_capacity >= 1),
  class_type     text generated always as
                 (case when max_capacity = 1 then 'private' else 'group' end) stored,
  status         text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  location       text,
  created_at     timestamptz not null default now(),
  constraint classes_time_valid check (ends_at > starts_at),
  constraint classes_instructor_membership_fkey foreign key (studio_id, instructor_id)
    references public.studio_members (studio_id, user_id) on delete restrict,
  -- 같은 스튜디오에서 같은 강사의 진행 예정 수업끼리 시간이 겹치면 거부
  constraint classes_no_instructor_overlap exclude using gist (
    studio_id with =,
    instructor_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'scheduled')
);
create index classes_studio_time_idx on public.classes (studio_id, starts_at);
create index classes_instructor_idx  on public.classes (instructor_id, starts_at);

-- 1-6. bookings : 예약
create table public.bookings (
  id             uuid primary key default gen_random_uuid(),
  studio_id      uuid not null references public.studios (id) on delete cascade,
  class_id       uuid not null
                 constraint bookings_class_id_fkey  references public.classes (id) on delete cascade,
  member_id      uuid not null
                 constraint bookings_member_id_fkey references public.users (id) on delete cascade,
  pass_id        uuid
                 constraint bookings_pass_id_fkey   references public.passes (id) on delete set null,
  status         text not null
                 check (status in ('confirmed', 'waitlist', 'cancelled', 'attended', 'no_show')),
  pass_refunded  boolean not null default false,
  promoted_at    timestamptz,
  cancelled_at   timestamptz,
  cancelled_by   uuid references public.users (id) on delete set null,
  checked_at     timestamptz,
  checked_by     uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index bookings_one_active_per_member
  on public.bookings (class_id, member_id) where status <> 'cancelled';
create index bookings_class_idx  on public.bookings (class_id, status, created_at);
create index bookings_member_idx on public.bookings (studio_id, member_id, created_at desc);

-- 1-7. pass_logs : 수강권 횟수 변동 원장(append-only)
create table public.pass_logs (
  id               bigint generated always as identity primary key,
  studio_id        uuid not null references public.studios (id) on delete cascade,
  pass_id          uuid not null references public.passes (id)   on delete cascade,
  member_id        uuid not null references public.users (id)    on delete cascade,
  booking_id       uuid          references public.bookings (id) on delete set null,
  delta            int  not null,
  remaining_after  int  not null,
  reason           text not null
                   constraint pass_logs_reason_check check (reason in (
                     'issued', 'booking', 'waitlist_promotion',
                     'cancel_refund', 'class_cancelled', 'admin_adjust',
                     'extended', 'deactivated', 'reactivated'
                   )),
  memo             text,
  actor_id         uuid references public.users (id) on delete set null,
  created_at       timestamptz not null default now()
);
create index pass_logs_pass_idx   on public.pass_logs (pass_id, created_at desc);
create index pass_logs_member_idx on public.pass_logs (studio_id, member_id, created_at desc);

-- 1-8. pass_payments : 수강권 결제 기록(선택 입력). 원장만 조회 → 추후 매출 화면
create table public.pass_payments (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references public.studios (id) on delete cascade,
  pass_id     uuid not null references public.passes (id) on delete cascade,
  member_id   uuid not null references public.users (id) on delete cascade,
  amount      int  not null check (amount >= 0),
  method      text not null default 'card' check (method in ('card', 'cash', 'transfer', 'other')),
  paid_on     date not null default ((now() at time zone 'Asia/Seoul')::date),  -- 한국 날짜 (UTC 기준이면 오전 9시 전 결제가 전날로 잡힘)
  memo        text,
  created_by  uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index pass_payments_studio_idx on public.pass_payments (studio_id, paid_on desc);
create index pass_payments_pass_idx   on public.pass_payments (pass_id);



-- -----------------------------------------------------------------------------
-- 2. 권한 헬퍼 — "이 스튜디오에서 나의 역할"
-- -----------------------------------------------------------------------------

create or replace function public.studio_role(p_studio uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.studio_members
   where studio_id = p_studio and user_id = auth.uid() and status = 'active';
$$;

create or replace function public.is_studio_member(p_studio uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.studio_role(p_studio) is not null;
$$;

create or replace function public.is_studio_staff(p_studio uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.studio_role(p_studio) in ('owner', 'manager', 'instructor'), false);
$$;

create or replace function public.is_studio_admin(p_studio uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.studio_role(p_studio) in ('owner', 'manager'), false);
$$;

-- 내가 이 사람의 프로필을 볼 수 있는가: 본인이거나, 내가 직원으로 있는 스튜디오에 그 사람이 소속
create or replace function public.can_view_user(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_user = auth.uid() or exists (
    select 1
      from public.studio_members me
      join public.studio_members them on them.studio_id = me.studio_id
     where me.user_id = auth.uid()
       and me.status = 'active'
       and me.role in ('owner', 'manager', 'instructor')
       and them.user_id = p_user
  );
$$;

-- 초대 코드: 헷갈리는 문자(0,O,1,I) 제외 6자리
create or replace function public._new_invite_code()
returns text
language sql volatile
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
    from generate_series(1, 6);
$$;


-- -----------------------------------------------------------------------------
-- 3. 공통 트리거
-- -----------------------------------------------------------------------------

-- 3-1. 회원가입 시 프로필 자동 생성 (스튜디오 소속은 앱에서 '만들기' 또는 '코드 참여'로)
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.users (id, email, name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3-2. bookings.updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger bookings_touch_updated_at
  before update on public.bookings
  for each row execute function public.touch_updated_at();

-- 3-3. 수강권 발급 로그
create or replace function public.log_pass_issued()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.pass_logs (studio_id, pass_id, member_id, delta, remaining_after, reason, actor_id)
  values (new.studio_id, new.id, new.member_id, new.remaining_count, new.remaining_count, 'issued', auth.uid());
  return new;
end;
$$;

create trigger passes_log_issued
  after insert on public.passes
  for each row execute function public.log_pass_issued();

-- 3-4. 수업 담당자는 그 스튜디오의 활성 직원이어야 한다 + 스튜디오 이동 금지
create or replace function public.validate_class()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.studio_id is distinct from old.studio_id then
    raise exception '수업의 스튜디오는 바꿀 수 없습니다.';
  end if;
  if tg_op = 'INSERT' or new.instructor_id is distinct from old.instructor_id then
    if not exists (
      select 1 from public.studio_members
       where studio_id = new.studio_id and user_id = new.instructor_id
         and status = 'active' and role in ('owner', 'manager', 'instructor')
    ) then
      raise exception '담당 강사는 이 스튜디오의 강사·관리자·원장이어야 합니다.';
    end if;
  end if;
  return new;
end;
$$;

create trigger classes_validate
  before insert or update on public.classes
  for each row execute function public.validate_class();

-- 3-5. 정원 변경 가드: 예약 인원보다 작게 줄이기 / 예약이 있는데 1:1 ↔ 그룹 전환 / 폐강 취소 금지
create or replace function public.guard_class_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_seated int;
  v_active int;
begin
  if old.status = 'cancelled' and new.status = 'scheduled' then
    raise exception '폐강된 수업은 되살릴 수 없습니다. 새로 등록해 주세요.';
  end if;

  if new.max_capacity is distinct from old.max_capacity then
    select count(*) filter (where status in ('confirmed', 'attended', 'no_show')),
           count(*) filter (where status <> 'cancelled')
      into v_seated, v_active
      from public.bookings
     where class_id = new.id;

    if new.max_capacity < v_seated then
      raise exception '현재 예약 인원(%명)보다 정원을 줄일 수 없습니다.', v_seated;
    end if;
    if (new.max_capacity = 1) <> (old.max_capacity = 1) and v_active > 0 then
      raise exception '예약이 있는 수업은 1:1 ↔ 그룹 유형을 바꿀 수 없습니다.';
    end if;
  end if;

  return new;
end;
$$;

create trigger classes_guard_update
  before update on public.classes
  for each row execute function public.guard_class_update();


-- -----------------------------------------------------------------------------
-- 4. 내부 함수 (클라이언트에서 직접 호출 불가 — 맨 아래에서 EXECUTE 회수)
-- -----------------------------------------------------------------------------

-- 4-0. 이 수업을 관리할 수 있는가: 원장·실장은 모든 수업, 강사는 본인 담당 수업만
create or replace function public._can_manage_class(p_class public.classes)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.studio_role(p_class.studio_id), '') in ('owner', 'manager')
      or (public.studio_role(p_class.studio_id) = 'instructor' and p_class.instructor_id = auth.uid());
$$;

-- 4-1. 수강권 횟수 증감 + 로그. 횟수가 바뀌는 유일한 통로.
create or replace function public._apply_pass_delta(
  p_pass_id    uuid,
  p_delta      int,
  p_reason     text,
  p_booking_id uuid default null,
  p_memo       text default null
)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_studio    uuid;
  v_member    uuid;
  v_remaining int;
begin
  update public.passes
     set remaining_count = remaining_count + p_delta
   where id = p_pass_id
  returning studio_id, member_id, remaining_count into v_studio, v_member, v_remaining;

  if not found then
    raise exception '수강권을 찾을 수 없습니다.';
  end if;

  insert into public.pass_logs (studio_id, pass_id, member_id, booking_id, delta, remaining_after, reason, memo, actor_id)
  values (v_studio, p_pass_id, v_member, p_booking_id, p_delta, v_remaining, p_reason, p_memo, auth.uid());

  return v_remaining;
end;
$$;

-- 4-2. 이 스튜디오에서, 수업 유형·수업일에 유효한 수강권 1장을 잠그고 반환(만료 임박 순)
create or replace function public._find_usable_pass(
  p_studio_id  uuid,
  p_member_id  uuid,
  p_class_type text,
  p_starts_at  timestamptz
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_pass_id    uuid;
  v_class_date date := (p_starts_at at time zone 'Asia/Seoul')::date;
begin
  select id into v_pass_id
    from public.passes
   where studio_id = p_studio_id
     and member_id = p_member_id
     and class_type = p_class_type
     and is_active
     and remaining_count > 0
     and v_class_date between starts_on and expires_on
   order by expires_on, created_at
   limit 1
     for update;
  return v_pass_id;
end;
$$;

-- 4-3. 대기열 자동 승격: 빈자리가 있는 동안 대기 1순위부터 확정 + 수강권 차감.
--      유효한 수강권이 없는 대기자는 건너뛴다.
create or replace function public._promote_waitlist(p_class_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_class     public.classes;
  v_wait      public.bookings;
  v_taken     int;
  v_pass_id   uuid;
  v_promoted  boolean;
  v_count     int := 0;
begin
  select * into v_class from public.classes where id = p_class_id for update;
  if not found or v_class.status <> 'scheduled' or v_class.starts_at <= now() then
    return 0;
  end if;

  loop
    select count(*) into v_taken
      from public.bookings
     where class_id = p_class_id and status in ('confirmed', 'attended', 'no_show');
    exit when v_taken >= v_class.max_capacity;

    v_promoted := false;
    for v_wait in
      select * from public.bookings
       where class_id = p_class_id and status = 'waitlist'
       order by created_at, id
         for update
    loop
      v_pass_id := public._find_usable_pass(v_class.studio_id, v_wait.member_id, v_class.class_type, v_class.starts_at);
      continue when v_pass_id is null;

      update public.bookings
         set status = 'confirmed', pass_id = v_pass_id, promoted_at = now()
       where id = v_wait.id;
      perform public._apply_pass_delta(v_pass_id, -1, 'waitlist_promotion', v_wait.id);
      -- 자동 승격은 사람이 처리한 게 아니므로, 빈자리를 만든 사람(취소·정원 변경한 사람) 이름을 남기지 않는다
      update public.pass_logs
         set actor_id = null, memo = '빈자리가 생겨 대기 순번대로 자동 확정'
       where booking_id = v_wait.id and reason = 'waitlist_promotion' and actor_id is not null;

      v_promoted := true;
      v_count := v_count + 1;
      exit;
    end loop;

    exit when not v_promoted;
  end loop;

  return v_count;
end;
$$;


-- -----------------------------------------------------------------------------
-- 5. 대기열 승격 트리거
-- -----------------------------------------------------------------------------

create or replace function public.trg_booking_cancelled_promote()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public._promote_waitlist(new.class_id);
  return null;
end;
$$;

create trigger bookings_promote_on_cancel
  after update of status on public.bookings
  for each row
  when (old.status = 'confirmed' and new.status = 'cancelled')
  execute function public.trg_booking_cancelled_promote();

create or replace function public.trg_class_capacity_promote()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public._promote_waitlist(new.id);
  return null;
end;
$$;

create trigger classes_promote_on_capacity_up
  after update of max_capacity on public.classes
  for each row
  when (new.max_capacity > old.max_capacity)
  execute function public.trg_class_capacity_promote();


-- -----------------------------------------------------------------------------
-- 6. RPC — 스튜디오
-- -----------------------------------------------------------------------------

-- 6-1. 스튜디오 만들기: 만든 사람이 원장(owner)이 된다
create or replace function public.create_studio(p_name text)
returns public.studios
language plpgsql security definer set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_studio public.studios;
  v_try    int := 0;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception '스튜디오 이름을 입력해 주세요.';
  end if;

  loop
    begin
      insert into public.studios (name, invite_code, created_by)
      values (btrim(p_name), public._new_invite_code(), v_uid)
      returning * into v_studio;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try >= 5 then raise; end if;
    end;
  end loop;

  insert into public.studio_members (studio_id, user_id, role) values (v_studio.id, v_uid, 'owner');
  return v_studio;
end;
$$;

-- 6-2. 초대 코드로 참여: 회원(member)으로 들어간다. 이미 소속이면 그대로, 나갔던 곳이면 다시 활성화
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

  select * into v_studio from public.studios where invite_code = v_code;
  if not found then
    raise exception '초대 코드를 찾을 수 없습니다. 다시 확인해 주세요.';
  end if;

  insert into public.studio_members (studio_id, user_id, role)
  values (v_studio.id, v_uid, 'member')
  on conflict (studio_id, user_id) do update
    set status = 'active'
  where public.studio_members.status = 'left';

  return v_studio;
end;
$$;

-- 6-3. 초대 코드 재발급(원장·관리자): 코드가 퍼졌을 때
create or replace function public.regenerate_invite_code(p_studio_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_code text;
  v_try  int := 0;
begin
  if not public.is_studio_admin(p_studio_id) then
    raise exception '원장 또는 관리자만 초대 코드를 바꿀 수 있습니다.';
  end if;
  loop
    begin
      update public.studios set invite_code = public._new_invite_code()
       where id = p_studio_id
      returning invite_code into v_code;
      exit;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try >= 5 then raise; end if;
    end;
  end loop;
  return v_code;
end;
$$;

-- 6-4. 역할 변경
--   원장: 모든 역할 지정 가능(다른 원장 지정·해제 포함)
--   관리자: 강사·회원만 (원장·관리자는 건드릴 수 없음)
--   본인 역할은 변경 불가 → 원장이 0명이 되는 일이 없다
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
-- 7. RPC — 예약 / 취소 / 출석 / 폐강 / 수강권 조정
-- -----------------------------------------------------------------------------

-- 7-1. 예약: 자리가 있으면 확정 + 차감, 그룹 수업이 만석이면 대기 등록(차감 없음)
--      p_member_id 는 직원이 회원 대신 예약할 때만 사용.
create or replace function public.book_class(
  p_class_id  uuid,
  p_member_id uuid default null
)
returns public.bookings
language plpgsql security definer set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_member   uuid;
  v_class    public.classes;
  v_taken    int;
  v_pass_id  uuid;
  v_booking  public.bookings;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.';
  end if;
  v_member := coalesce(p_member_id, v_uid);

  select * into v_class from public.classes where id = p_class_id for update;
  if not found or not public.is_studio_member(v_class.studio_id) then
    raise exception '수업을 찾을 수 없습니다.';
  end if;
  -- 대신 예약: 원장·실장은 모든 수업, 강사는 본인 수업만
  if v_member <> v_uid and not public._can_manage_class(v_class) then
    if public.is_studio_staff(v_class.studio_id) then
      raise exception '담당 강사 또는 원장·관리자만 이 수업에 대신 예약할 수 있습니다.';
    end if;
    raise exception '다른 회원의 예약을 생성할 권한이 없습니다.';
  end if;
  if not exists (
    select 1 from public.studio_members
     where studio_id = v_class.studio_id and user_id = v_member
       and status = 'active' and role = 'member'
  ) then
    raise exception '이 스튜디오의 회원만 예약할 수 있습니다.';
  end if;
  if v_class.status <> 'scheduled' then
    raise exception '취소된 수업입니다.';
  end if;
  if v_class.starts_at <= now() then
    raise exception '이미 시작된 수업은 예약할 수 없습니다.';
  end if;

  if exists (select 1 from public.bookings
              where class_id = p_class_id and member_id = v_member and status <> 'cancelled') then
    raise exception '이미 예약(또는 대기)한 수업입니다.';
  end if;

  v_pass_id := public._find_usable_pass(v_class.studio_id, v_member, v_class.class_type, v_class.starts_at);
  if v_pass_id is null then
    raise exception '사용 가능한 % 수강권이 없습니다.',
      case v_class.class_type when 'private' then '1:1 개인' else '그룹' end;
  end if;

  select count(*) into v_taken
    from public.bookings
   where class_id = p_class_id and status in ('confirmed', 'attended', 'no_show');

  if v_taken < v_class.max_capacity then
    insert into public.bookings (studio_id, class_id, member_id, pass_id, status)
    values (v_class.studio_id, p_class_id, v_member, v_pass_id, 'confirmed')
    returning * into v_booking;
    perform public._apply_pass_delta(v_pass_id, -1, 'booking', v_booking.id);
  elsif v_class.max_capacity = 1 then
    raise exception '이미 예약이 마감된 1:1 수업입니다.';
  else
    insert into public.bookings (studio_id, class_id, member_id, status)
    values (v_class.studio_id, p_class_id, v_member, 'waitlist')
    returning * into v_booking;
  end if;

  return v_booking;
end;
$$;

-- 7-2. 취소
--   회원 본인: 수업 시작 24시간 전까지만 횟수 복구.
--   직원이 대신 취소: p_refund 로 복구 여부 선택(기본 복구).
create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_refund     boolean default null
)
returns public.bookings
language plpgsql security definer set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_staff    boolean;
  v_class_id uuid;
  v_class    public.classes;
  v_booking  public.bookings;
  v_refund   boolean := false;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select class_id into v_class_id from public.bookings where id = p_booking_id;
  if not found then
    raise exception '예약을 찾을 수 없습니다.';
  end if;

  -- 잠금 순서는 항상 classes → bookings (book_class 와 동일) : 교착 방지
  select * into v_class   from public.classes  where id = v_class_id   for update;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  -- 직원 권한: 원장·실장은 모든 수업, 강사는 본인 수업의 예약만 관리
  v_staff := public._can_manage_class(v_class);

  if v_booking.member_id <> v_uid and not v_staff then
    if public.is_studio_staff(v_class.studio_id) then
      raise exception '담당 강사 또는 원장·관리자만 이 수업의 예약을 취소할 수 있습니다.';
    end if;
    raise exception '본인의 예약만 취소할 수 있습니다.';
  end if;
  if v_booking.status not in ('confirmed', 'waitlist') then
    raise exception '취소할 수 없는 예약 상태입니다.';
  end if;
  if not v_staff and v_class.starts_at <= now() then
    raise exception '이미 시작된 수업은 취소할 수 없습니다.';
  end if;

  if v_booking.status = 'confirmed' and v_booking.pass_id is not null then
    if v_staff and v_booking.member_id <> v_uid then
      v_refund := coalesce(p_refund, true);
    else
      v_refund := now() <= v_class.starts_at - interval '24 hours';
    end if;
    if v_refund then
      perform public._apply_pass_delta(v_booking.pass_id, 1, 'cancel_refund', v_booking.id);
    end if;
  end if;

  update public.bookings
     set status = 'cancelled', pass_refunded = v_refund, cancelled_at = now(), cancelled_by = v_uid
   where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

-- 7-3. 출석 / 노쇼 원클릭 (p_status = 'confirmed' 는 되돌리기). 노쇼는 복구 없음.
--      출석은 시작 30분 전부터, 노쇼는 시작 후에만.
create or replace function public.mark_attendance(
  p_booking_id uuid,
  p_status     text
)
returns public.bookings
language plpgsql security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_booking public.bookings;
  v_class   public.classes;
  v_role    text;
begin
  if p_status not in ('attended', 'no_show', 'confirmed') then
    raise exception '허용되지 않는 상태입니다: %', p_status;
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception '예약을 찾을 수 없습니다.';
  end if;
  select * into v_class from public.classes where id = v_booking.class_id;
  v_role := public.studio_role(v_class.studio_id);

  if not (coalesce(v_role, '') in ('owner', 'manager')
          or (v_role = 'instructor' and v_class.instructor_id = v_uid)) then
    raise exception '담당 강사 또는 원장·관리자만 출석을 처리할 수 있습니다.';
  end if;
  if v_booking.status not in ('confirmed', 'attended', 'no_show') then
    raise exception '확정된 예약만 출석 처리할 수 있습니다.';
  end if;

  -- 처리 시점: 출석은 수업 시작 30분 전부터(일찍 온 회원 체크인), 노쇼는 수업 시작 후. 되돌리기는 언제나
  if p_status = 'attended' and now() < v_class.starts_at - interval '30 minutes' then
    raise exception '출석은 수업 시작 30분 전부터 처리할 수 있습니다.';
  end if;
  if p_status = 'no_show' and now() < v_class.starts_at then
    raise exception '노쇼는 수업이 시작된 뒤에 처리할 수 있습니다.';
  end if;

  update public.bookings
     set status = p_status,
         checked_at = case when p_status = 'confirmed' then null else now() end,
         checked_by = case when p_status = 'confirmed' then null else v_uid end
   where id = p_booking_id
  returning * into v_booking;

  return v_booking;
end;
$$;

-- 7-4. 폐강: 확정 예약은 전원 횟수 복구 후 취소, 대기는 취소
create or replace function public.cancel_class(p_class_id uuid)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_class   public.classes;
  v_role    text;
  v_booking public.bookings;
  v_count   int := 0;
begin
  select * into v_class from public.classes where id = p_class_id for update;
  if not found then
    raise exception '수업을 찾을 수 없습니다.';
  end if;
  v_role := public.studio_role(v_class.studio_id);
  if not (coalesce(v_role, '') in ('owner', 'manager')
          or (v_role = 'instructor' and v_class.instructor_id = v_uid)) then
    raise exception '담당 강사 또는 원장·관리자만 폐강할 수 있습니다.';
  end if;

  update public.classes set status = 'cancelled' where id = p_class_id;

  for v_booking in
    select * from public.bookings
     where class_id = p_class_id and status in ('confirmed', 'waitlist')
       for update
  loop
    if v_booking.status = 'confirmed' and v_booking.pass_id is not null then
      perform public._apply_pass_delta(v_booking.pass_id, 1, 'class_cancelled', v_booking.id);
    end if;
    update public.bookings
       set status = 'cancelled',
           pass_refunded = (v_booking.status = 'confirmed' and v_booking.pass_id is not null),
           cancelled_at = now(),
           cancelled_by = v_uid
     where id = v_booking.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- 7-5. 수강권 관리 (원장·관리자). 수강권 변경은 이 함수들로만 → 변동 내역(pass_logs)에 전부 기록
-- 7-5-1. 발급 (원장·관리자). 결제 금액은 선택
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

-- 7-5-2. 기간 연장/단축 (홀딩·보상). 음수면 단축
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

-- 7-5-3. 사용 중지 / 재개 (환불·양도 등). 중지된 수강권은 새 예약에 쓰이지 않는다(기존 예약은 유지)
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

-- 7-5-4. 횟수 조정 (보상 +1, 오차 정정 등). 총 횟수를 넘겨 늘리면 총 횟수도 함께 늘린다
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
-- 8. 시간표용 뷰: 예약 인원 / 대기 인원 / 내 예약 상태
--    정의자 권한(security_invoker = false)이라 RLS 를 우회하므로,
--    "내가 소속된 스튜디오의 수업"만 나오도록 WHERE 로 직접 거른다. 개인 정보는 포함하지 않는다.
-- -----------------------------------------------------------------------------
create view public.class_overview
with (security_invoker = false)
as
select
  c.id,
  c.studio_id,
  c.title,
  c.instructor_id,
  u.name                               as instructor_name,
  c.starts_at,
  c.ends_at,
  c.max_capacity,
  c.class_type,
  c.status,
  c.location,
  coalesce(s.confirmed_count, 0)::int  as confirmed_count,
  coalesce(s.waitlist_count, 0)::int   as waitlist_count,
  mb.id                                as my_booking_id,
  mb.status                            as my_booking_status,
  case when mb.status = 'waitlist' then (
    select count(*)::int
      from public.bookings w
     where w.class_id = c.id
       and w.status = 'waitlist'
       and (w.created_at, w.id) <= (mb.created_at, mb.id)
  ) end                                as my_waitlist_position
from public.classes c
join public.users u on u.id = c.instructor_id
left join lateral (
  select
    count(*) filter (where b.status in ('confirmed', 'attended', 'no_show')) as confirmed_count,
    count(*) filter (where b.status = 'waitlist')                             as waitlist_count
  from public.bookings b
  where b.class_id = c.id
) s on true
left join lateral (
  select b.id, b.status, b.created_at
    from public.bookings b
   where b.class_id = c.id
     and b.member_id = auth.uid()
     and b.status <> 'cancelled'
   limit 1
) mb on true
where exists (
  select 1 from public.studio_members sm
   where sm.studio_id = c.studio_id and sm.user_id = auth.uid() and sm.status = 'active'
);


-- -----------------------------------------------------------------------------
-- 9. Row Level Security
-- -----------------------------------------------------------------------------
alter table public.users          enable row level security;
alter table public.studios        enable row level security;
alter table public.studio_members enable row level security;
alter table public.passes         enable row level security;
alter table public.classes        enable row level security;
alter table public.bookings       enable row level security;
alter table public.pass_logs      enable row level security;
alter table public.pass_payments  enable row level security;

-- users : 본인, 또는 내가 직원인 스튜디오의 소속자. 수정은 본인만(이름·연락처)
create policy users_select on public.users
  for select to authenticated using (public.can_view_user(id));
create policy users_update_self on public.users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- studios : 소속된 곳만. 이름 변경은 원장·관리자. 생성은 create_studio() 로만
create policy studios_select on public.studios
  for select to authenticated using (public.is_studio_member(id));
create policy studios_update_admin on public.studios
  for update to authenticated using (public.is_studio_admin(id)) with check (public.is_studio_admin(id));

-- studio_members : 내 소속 행 + 내가 직원인 스튜디오의 전체 명단. 메모 수정은 원장·관리자
create policy studio_members_select on public.studio_members
  for select to authenticated using (user_id = auth.uid() or public.is_studio_staff(studio_id));
create policy studio_members_update_memo on public.studio_members
  for update to authenticated
  using (public.is_studio_admin(studio_id)) with check (public.is_studio_admin(studio_id));

-- passes : 본인 또는 그 스튜디오 직원 조회
create policy passes_select on public.passes
  for select to authenticated using (member_id = auth.uid() or public.is_studio_staff(studio_id));
-- 발급·수정 정책 없음: issue_pass / extend_pass / set_pass_active / admin_adjust_pass 로만

-- pass_payments : 원장만 조회. 기록은 issue_pass 로만
create policy pass_payments_owner_select on public.pass_payments
  for select to authenticated using (public.studio_role(studio_id) = 'owner');

-- classes : 소속자 조회. 원장·관리자는 전부, 강사는 본인 수업만 생성/수정. 삭제는 불가(폐강만)
create policy classes_select on public.classes
  for select to authenticated using (public.is_studio_member(studio_id));
create policy classes_staff_insert on public.classes
  for insert to authenticated
  with check (
    public.is_studio_admin(studio_id)
    or (public.studio_role(studio_id) = 'instructor' and instructor_id = auth.uid())
  );
create policy classes_staff_update on public.classes
  for update to authenticated
  using (
    public.is_studio_admin(studio_id)
    or (public.studio_role(studio_id) = 'instructor' and instructor_id = auth.uid())
  )
  with check (
    public.is_studio_admin(studio_id)
    or (public.studio_role(studio_id) = 'instructor' and instructor_id = auth.uid())
  );

-- bookings / pass_logs : 조회만 (본인 또는 그 스튜디오 직원). 쓰기는 RPC 로만
create policy bookings_select on public.bookings
  for select to authenticated using (member_id = auth.uid() or public.is_studio_staff(studio_id));
create policy pass_logs_select on public.pass_logs
  for select to authenticated using (member_id = auth.uid() or public.is_studio_staff(studio_id));


-- -----------------------------------------------------------------------------
-- 10. GRANT 정리
-- -----------------------------------------------------------------------------
revoke all on public.users, public.studios, public.studio_members, public.passes,
              public.classes, public.bookings, public.pass_logs, public.pass_payments from anon, authenticated;
revoke all on public.class_overview from anon, authenticated, public;

grant select                         on public.users          to authenticated;
grant update (name, phone)           on public.users          to authenticated;
grant select                         on public.studios        to authenticated;
grant update (name)                  on public.studios        to authenticated;
grant select                         on public.studio_members to authenticated;
grant update (memo)                  on public.studio_members to authenticated;
grant select                         on public.passes         to authenticated;
grant select, insert, update         on public.classes        to authenticated;
grant select                         on public.bookings       to authenticated;
grant select                         on public.pass_logs      to authenticated;
grant select                         on public.pass_payments  to authenticated;
grant select                         on public.class_overview to authenticated;

-- 내부 함수·트리거 함수는 클라이언트에서 호출 불가
revoke execute on function public._apply_pass_delta(uuid, int, text, uuid, text)        from public, anon, authenticated;
revoke execute on function public._find_usable_pass(uuid, uuid, text, timestamptz)      from public, anon, authenticated;
revoke execute on function public._promote_waitlist(uuid)                               from public, anon, authenticated;
revoke execute on function public._new_invite_code()                                    from public, anon, authenticated;
revoke execute on function public.handle_new_user()                                     from public, anon, authenticated;
revoke execute on function public.log_pass_issued()                                     from public, anon, authenticated;
revoke execute on function public._can_manage_class(public.classes)                    from public, anon, authenticated;
revoke execute on function public.validate_class()                                      from public, anon, authenticated;
revoke execute on function public.guard_class_update()                                  from public, anon, authenticated;
revoke execute on function public.trg_booking_cancelled_promote()                       from public, anon, authenticated;
revoke execute on function public.trg_class_capacity_promote()                          from public, anon, authenticated;

-- 헬퍼·RPC 는 로그인 사용자만
revoke execute on function public.studio_role(uuid)                       from public, anon;
revoke execute on function public.is_studio_member(uuid)                  from public, anon;
revoke execute on function public.is_studio_staff(uuid)                   from public, anon;
revoke execute on function public.is_studio_admin(uuid)                   from public, anon;
revoke execute on function public.can_view_user(uuid)                     from public, anon;
revoke execute on function public.create_studio(text)                     from public, anon;
revoke execute on function public.join_studio(text)                       from public, anon;
revoke execute on function public.regenerate_invite_code(uuid)            from public, anon;
revoke execute on function public.set_member_role(uuid, uuid, text)       from public, anon;
revoke execute on function public.book_class(uuid, uuid)                  from public, anon;
revoke execute on function public.cancel_booking(uuid, boolean)           from public, anon;
revoke execute on function public.mark_attendance(uuid, text)             from public, anon;
revoke execute on function public.cancel_class(uuid)                      from public, anon;
revoke execute on function public.admin_adjust_pass(uuid, int, text)      from public, anon;
revoke execute on function public.issue_pass(uuid, uuid, text, text, int, date, date, int, text, text) from public, anon;
revoke execute on function public.extend_pass(uuid, int, text)            from public, anon;
revoke execute on function public.set_pass_active(uuid, boolean, text)    from public, anon;

grant execute on function public.studio_role(uuid)                        to authenticated;
grant execute on function public.is_studio_member(uuid)                   to authenticated;
grant execute on function public.is_studio_staff(uuid)                    to authenticated;
grant execute on function public.is_studio_admin(uuid)                    to authenticated;
grant execute on function public.can_view_user(uuid)                      to authenticated;
grant execute on function public.create_studio(text)                      to authenticated;
grant execute on function public.join_studio(text)                        to authenticated;
grant execute on function public.regenerate_invite_code(uuid)             to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text)        to authenticated;
grant execute on function public.book_class(uuid, uuid)                   to authenticated;
grant execute on function public.cancel_booking(uuid, boolean)            to authenticated;
grant execute on function public.mark_attendance(uuid, text)              to authenticated;
grant execute on function public.cancel_class(uuid)                       to authenticated;
grant execute on function public.admin_adjust_pass(uuid, int, text)       to authenticated;
grant execute on function public.issue_pass(uuid, uuid, text, text, int, date, date, int, text, text) to authenticated;
grant execute on function public.extend_pass(uuid, int, text)             to authenticated;
grant execute on function public.set_pass_active(uuid, boolean, text)     to authenticated;


-- -----------------------------------------------------------------------------
-- 10-1. 수강권 상품 (스튜디오별 가격표) — 원장·실장이 등록·수정·숨김, 발급 화면에서 골라 자동 채움
--       삭제 대신 숨김(is_active = false). 이미 발급된 수강권에는 영향 없음(발급 시 값 복사)
-- -----------------------------------------------------------------------------
create table if not exists public.pass_products (
  id              uuid primary key default gen_random_uuid(),
  studio_id       uuid not null references public.studios (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 40),
  class_type      text not null check (class_type in ('private', 'group')),
  total_count     int  not null check (total_count between 1 and 500),
  duration_value  int  not null check (duration_value between 1 and 730),
  duration_unit   text not null default 'month' check (duration_unit in ('day', 'month')),
  price           int  check (price is null or (price >= 0 and price <= 100000000)),
  is_active       boolean not null default true,
  sort_order      int  not null default 0,
  created_by      uuid references public.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (duration_unit = 'day' or duration_value <= 24)
);
create index if not exists pass_products_studio_idx on public.pass_products (studio_id, is_active, sort_order, created_at);

drop trigger if exists pass_products_touch_updated_at on public.pass_products;
create trigger pass_products_touch_updated_at
  before update on public.pass_products
  for each row execute function public.touch_updated_at();

alter table public.pass_products enable row level security;

drop policy if exists pass_products_admin_select on public.pass_products;
drop policy if exists pass_products_admin_insert on public.pass_products;
drop policy if exists pass_products_admin_update on public.pass_products;
create policy pass_products_admin_select on public.pass_products
  for select to authenticated using (public.is_studio_admin(studio_id));
create policy pass_products_admin_insert on public.pass_products
  for insert to authenticated with check (public.is_studio_admin(studio_id) and created_by = auth.uid());
create policy pass_products_admin_update on public.pass_products
  for update to authenticated using (public.is_studio_admin(studio_id)) with check (public.is_studio_admin(studio_id));

revoke all on public.pass_products from anon, authenticated, public;
grant select on public.pass_products to authenticated;
grant insert (studio_id, name, class_type, total_count, duration_value, duration_unit, price, is_active, sort_order, created_by)
  on public.pass_products to authenticated;
grant update (name, class_type, total_count, duration_value, duration_unit, price, is_active, sort_order)
  on public.pass_products to authenticated;


-- -----------------------------------------------------------------------------
-- 11. 이미 가입된 계정의 프로필 채우기 (v1 → v2 로 다시 설치한 경우)
-- -----------------------------------------------------------------------------
insert into public.users (id, email, name, phone)
select id, email, coalesce(raw_user_meta_data ->> 'name', ''), raw_user_meta_data ->> 'phone'
  from auth.users
on conflict (id) do nothing;
