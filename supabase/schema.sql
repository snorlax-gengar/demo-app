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
  created_at  timestamptz not null default now(),
  withdrawn_at timestamptz                         -- 탈퇴 시각. 탈퇴하면 이름 '탈퇴 회원', 연락처·이메일 삭제
);

-- 1-2. studios : 스튜디오(또는 과외 선생님 1인 공간)
create table public.studios (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(btrim(name)) between 1 and 40),
  invite_code  text not null unique check (invite_code ~ '^[A-Z0-9]{6}$'),
  created_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  closed_at    timestamptz,                                    -- 운영 종료 시각 (014). 종료하면 모든 소속 탈퇴 처리
  closed_by    uuid references public.users (id) on delete set null
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

-- 3-5. 수업 수정 가드: 폐강 수업 수정/복구 금지, 시작된 수업 변경 금지, 과거 시간 변경 금지, 정원/유형 전환 가드
create or replace function public.guard_class_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_seated int;
  v_active int;
begin
  if old.status = 'cancelled' then
    if new.status = 'scheduled' then
      raise exception '폐강된 수업은 되살릴 수 없습니다. 새로 등록해 주세요.';
    end if;
    raise exception '폐강된 수업은 수정할 수 없습니다.';
  end if;

  -- 로그인 사용자의 일반 수정일 때만 시작 여부·과거 시간 검사 (관리자/마이그레이션용 service_role 은 예외)
  if auth.uid() is not null and new.status = 'scheduled' then
    if old.starts_at <= now() and (
      new.starts_at is distinct from old.starts_at
      or new.ends_at is distinct from old.ends_at
      or new.instructor_id is distinct from old.instructor_id
      or new.max_capacity is distinct from old.max_capacity
    ) then
      raise exception '이미 시작된 수업은 시간·강사·정원을 바꿀 수 없습니다.';
    end if;

    if (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at)
       and new.starts_at <= now() then
      raise exception '이미 지난 시간으로는 변경할 수 없습니다.';
    end if;
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

-- 7-6. 발급 후 결제 추가 (원장·관리자). 나중에 받은 금액·분할 결제를 매출에 넣는다
create or replace function public.add_pass_payment(
  p_pass_id  uuid,
  p_amount   int,
  p_method   text default 'card',
  p_paid_on  date default null,
  p_memo     text default null
)
returns public.pass_payments
language plpgsql security definer set search_path = public
as $$
declare
  v_pass    public.passes;
  v_today   date := (now() at time zone 'Asia/Seoul')::date;
  v_paid_on date := coalesce(p_paid_on, (now() at time zone 'Asia/Seoul')::date);
  v_row     public.pass_payments;
begin
  select * into v_pass from public.passes where id = p_pass_id;
  if not found or not public.is_studio_member(v_pass.studio_id) then
    raise exception '수강권을 찾을 수 없습니다.';
  end if;
  if not public.is_studio_admin(v_pass.studio_id) then
    raise exception '원장 또는 관리자만 결제를 추가할 수 있습니다.';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000000 then
    raise exception '결제 금액을 1원 이상으로 입력해 주세요.';
  end if;
  if coalesce(p_method, '') not in ('card', 'cash', 'transfer', 'other') then
    raise exception '결제 수단이 올바르지 않습니다.';
  end if;
  if v_paid_on > v_today then
    raise exception '결제일은 오늘 이후로 정할 수 없습니다.';
  end if;
  if v_paid_on < v_today - 365 then
    raise exception '결제일은 1년 이내로 정해 주세요.';
  end if;

  insert into public.pass_payments (studio_id, pass_id, member_id, amount, method, paid_on, memo, created_by)
  values (v_pass.studio_id, v_pass.id, v_pass.member_id, p_amount, p_method, v_paid_on,
          nullif(btrim(coalesce(p_memo, '')), ''), auth.uid())
  returning * into v_row;
  return v_row;
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
grant select, insert                 on public.classes        to authenticated;
grant update (title, instructor_id, starts_at, ends_at, max_capacity, location) on public.classes to authenticated;
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
revoke execute on function public.add_pass_payment(uuid, int, text, date, text) from public, anon;

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
grant execute on function public.add_pass_payment(uuid, int, text, date, text) to authenticated;


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
  kind          text not null constraint notifications_kind_check check (kind in ('booked_by_staff', 'waitlisted_by_staff', 'promoted', 'cancelled_by_staff', 'class_cancelled', 'reminder', 'studio_closed', 'close_request_new', 'close_request_approved', 'close_request_rejected', 'trial_request')),
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


-- -----------------------------------------------------------------------------
-- 10-5. 스튜디오 운영 종료 (내부): 권한 확인 없이 실제 처리. close_studio·withdraw_account 가 부른다
create or replace function public._close_studio(p_studio_id uuid, p_actor uuid, p_notify boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_studio    public.studios;
  v_class     public.classes;
  v_booking   public.bookings;
  v_classes   int := 0;
  v_bookings  int := 0;
  v_notified  int := 0;
  v_ids       uuid[] := '{}';
begin
  select * into v_studio from public.studios where id = p_studio_id for update;
  if not found then
    raise exception '스튜디오를 찾을 수 없습니다.';
  end if;
  if v_studio.closed_at is not null then
    return jsonb_build_object('already', true, 'classes', 0, 'bookings', 0, 'notified', 0);
  end if;

  -- 앞으로의 수업 폐강 + 예약·대기 취소(확정 예약은 수강권 1회 복구)
  for v_class in
    select * from public.classes
     where studio_id = p_studio_id and status = 'scheduled' and starts_at > now()
       for update
  loop
    update public.classes set status = 'cancelled' where id = v_class.id;
    v_classes := v_classes + 1;
    for v_booking in
      select * from public.bookings where class_id = v_class.id and status in ('confirmed', 'waitlist') for update
    loop
      if v_booking.status = 'confirmed' and v_booking.pass_id is not null then
        perform public._apply_pass_delta(v_booking.pass_id, 1, 'class_cancelled', v_booking.id);
      end if;
      update public.bookings
         set status = 'cancelled',
             pass_refunded = (v_booking.status = 'confirmed' and v_booking.pass_id is not null),
             cancelled_at = now(),
             cancelled_by = p_actor
       where id = v_booking.id;
      v_ids := v_ids || v_booking.id;
      v_bookings := v_bookings + 1;
    end loop;
  end loop;

  -- 수업별 "폐강" 알림 대신 운영 종료 알림 한 건으로 (푸시는 커밋 후 발송되므로 여기서 지우면 나가지 않는다)
  delete from public.notifications where booking_id = any (v_ids) and kind = 'class_cancelled';

  if p_notify then
    insert into public.notifications (user_id, studio_id, kind, title, body, data)
    select m.user_id, p_studio_id, 'studio_closed', v_studio.name,
           v_studio.name || ' 이(가) 운영을 종료했어요.' || E'\n' ||
           case when exists (select 1 from public.bookings b where b.id = any (v_ids) and b.member_id = m.user_id)
                then '남은 예약은 취소되고 사용한 수강권 횟수는 돌려드렸어요.'
                else '그동안 이용해 주셔서 감사합니다.' end,
           jsonb_build_object('path', '/notifications', 'studio_id', p_studio_id)
      from public.studio_members m
     where m.studio_id = p_studio_id and m.status = 'active' and m.user_id <> p_actor;
    get diagnostics v_notified = row_count;
  end if;

  update public.studio_members set status = 'left' where studio_id = p_studio_id and status = 'active';
  update public.studios set closed_at = now(), closed_by = p_actor where id = p_studio_id;

  return jsonb_build_object('already', false, 'classes', v_classes, 'bookings', v_bookings, 'notified', v_notified);
end;
$$;
revoke execute on function public._close_studio(uuid, uuid, boolean) from public, anon, authenticated;

-- 10-6. 운영자 계정 (앱 사용자 중 운영 종료 요청 알림을 받을 사람). 앱에서는 읽을 수 없다
create table if not exists public.app_operators (
  user_id    uuid primary key references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_operators enable row level security;
revoke all on public.app_operators from public, anon, authenticated;

-- 10-7. 운영 종료 요청
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

-- 10-8. 남은 수강권 계산 (내부)
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

-- 10-9. 스튜디오 운영 종료 (원장만). 남은 수강권이 있으면 거절, 실수 방지로 스튜디오 이름을 정확히 입력해야 한다
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

-- 10-10. 미리 보기 (원장만): 남은 수강권·최근 요청 포함
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

-- 10-11. 운영 종료 요청 (원장만, 남은 수강권이 있을 때). 운영자에게 알림
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

-- 10-12. 요청 취소 (원장만, 검토 중일 때)
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

-- 10-13. 운영자 처리 (SQL Editor 전용: 앱 사용자는 실행할 수 없다)
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

-- 10-15. 소개 페이지
create table if not exists public.studio_pages (
  studio_id      uuid primary key references public.studios (id) on delete cascade,
  slug           text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' and slug !~ '--'),
  published      boolean not null default false,
  headline       text check (char_length(headline) <= 60),
  intro          text check (char_length(intro) <= 2000),
  category       text check (char_length(category) <= 30),
  address        text check (char_length(address) <= 200),
  contact_phone  text check (contact_phone ~ '^[0-9+\- ()]{0,20}$'),
  kakao_url      text check (kakao_url ~ '^https://(open\.kakao\.com|pf\.kakao\.com)/' and char_length(kakao_url) <= 300),
  instagram      text check (instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  website_url    text check (website_url ~ '^https://' and char_length(website_url) <= 300),
  hours          text check (char_length(hours) <= 500),
  show_schedule  boolean not null default true,
  trial_enabled  boolean not null default true,
  trial_note     text check (char_length(trial_note) <= 300),
  photos         text[] not null default '{}' check (cardinality(photos) <= 6),
  updated_at     timestamptz not null default now()
);
alter table public.studio_pages enable row level security;
drop policy if exists studio_pages_admin_select on public.studio_pages;
create policy studio_pages_admin_select on public.studio_pages
  for select to authenticated using (public.is_studio_admin(studio_id));
revoke all on public.studio_pages from public, anon, authenticated;
grant select on public.studio_pages to authenticated;

-- 10-16. 체험 신청
create table if not exists public.trial_requests (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references public.studios (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 30),
  phone       text not null check (phone ~ '^[0-9]{9,12}$'),          -- 숫자만 저장 (01012345678)
  preferred   text check (char_length(preferred) <= 100),
  message     text check (char_length(message) <= 500),
  status      text not null default 'new' check (status in ('new', 'contacted', 'scheduled', 'done', 'declined')),
  memo        text check (char_length(memo) <= 500),
  consent_at  timestamptz not null,
  handled_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists trial_requests_studio_idx on public.trial_requests (studio_id, created_at desc);
alter table public.trial_requests enable row level security;
drop policy if exists trial_requests_admin_select on public.trial_requests;
create policy trial_requests_admin_select on public.trial_requests
  for select to authenticated using (public.is_studio_admin(studio_id));
revoke all on public.trial_requests from public, anon, authenticated;
grant select on public.trial_requests to authenticated;

-- 10-17. 페이지 저장 (원장·실장). 처음 저장할 때 만들어지고, 이후엔 고친다
create or replace function public.save_studio_page(p_studio_id uuid, p_page jsonb)
returns public.studio_pages
language plpgsql security definer set search_path = public
as $$
declare
  v_row  public.studio_pages;
  v_slug text := lower(btrim(coalesce(p_page->>'slug', '')));
  v_photos text[];
  t text;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if not public.is_studio_admin(p_studio_id) then
    raise exception '원장·실장만 소개 페이지를 고칠 수 있습니다.';
  end if;
  if exists (select 1 from public.studios where id = p_studio_id and closed_at is not null) then
    raise exception '운영을 종료한 스튜디오입니다.';
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' or v_slug ~ '--' then
    raise exception '주소 이름은 영어 소문자·숫자·하이픈(-)으로 3~30자예요. (예: pilates-namu)';
  end if;
  if exists (select 1 from public.studio_pages where slug = v_slug and studio_id <> p_studio_id) then
    raise exception '이미 다른 스튜디오가 쓰는 주소 이름이에요. 다른 이름을 골라 주세요.';
  end if;
  -- 사진은 이 스튜디오 폴더의 파일만
  v_photos := coalesce(array(select jsonb_array_elements_text(coalesce(p_page->'photos', '[]'::jsonb))), '{}');
  foreach t in array v_photos loop
    if t !~ ('^' || p_studio_id::text || '/[A-Za-z0-9._-]+$') then
      raise exception '사진 경로가 올바르지 않습니다.';
    end if;
  end loop;

  insert into public.studio_pages as sp (studio_id, slug, published, headline, intro, category, address, contact_phone,
                                         kakao_url, instagram, website_url, hours, show_schedule, trial_enabled, trial_note, photos, updated_at)
  values (p_studio_id, v_slug,
          coalesce((p_page->>'published')::boolean, false),
          nullif(btrim(p_page->>'headline'), ''), nullif(btrim(p_page->>'intro'), ''), nullif(btrim(p_page->>'category'), ''),
          nullif(btrim(p_page->>'address'), ''), nullif(btrim(p_page->>'contact_phone'), ''),
          nullif(btrim(p_page->>'kakao_url'), ''), nullif(ltrim(btrim(p_page->>'instagram'), '@'), ''),
          nullif(btrim(p_page->>'website_url'), ''), nullif(btrim(p_page->>'hours'), ''),
          coalesce((p_page->>'show_schedule')::boolean, true), coalesce((p_page->>'trial_enabled')::boolean, true),
          nullif(btrim(p_page->>'trial_note'), ''), v_photos, now())
  on conflict (studio_id) do update set
    slug = excluded.slug, published = excluded.published, headline = excluded.headline, intro = excluded.intro,
    category = excluded.category, address = excluded.address, contact_phone = excluded.contact_phone,
    kakao_url = excluded.kakao_url, instagram = excluded.instagram, website_url = excluded.website_url,
    hours = excluded.hours, show_schedule = excluded.show_schedule, trial_enabled = excluded.trial_enabled,
    trial_note = excluded.trial_note, photos = excluded.photos, updated_at = now()
  returning * into v_row;
  return v_row;
exception
  when check_violation then
    raise exception '입력값을 확인해 주세요. 카카오톡 링크는 https://open.kakao.com 또는 https://pf.kakao.com, 웹사이트는 https:// 로 시작해야 하고, 인스타그램은 아이디만 적어요.';
end;
$$;
revoke all on function public.save_studio_page(uuid, jsonb) from public, anon;
grant execute on function public.save_studio_page(uuid, jsonb) to authenticated;

-- 10-18. 공개 페이지 읽기 (로그인 없이). 공개 중이고 운영 중인 스튜디오만
create or replace function public.get_public_studio_page(p_slug text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_page public.studio_pages;
  v_name text;
begin
  select sp.* into v_page from public.studio_pages sp join public.studios s on s.id = sp.studio_id
   where sp.slug = lower(btrim(coalesce(p_slug, ''))) and sp.published and s.closed_at is null;
  if not found then
    return null;
  end if;
  select name into v_name from public.studios where id = v_page.studio_id;
  return jsonb_build_object(
    'slug', v_page.slug, 'name', v_name, 'headline', v_page.headline, 'intro', v_page.intro, 'category', v_page.category,
    'address', v_page.address, 'contact_phone', v_page.contact_phone, 'kakao_url', v_page.kakao_url,
    'instagram', v_page.instagram, 'website_url', v_page.website_url, 'hours', v_page.hours,
    'photos', to_jsonb(v_page.photos), 'trial_enabled', v_page.trial_enabled, 'trial_note', v_page.trial_note,
    'updated_at', v_page.updated_at,
    'schedule', case when v_page.show_schedule then coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', c.title, 'starts_at', c.starts_at, 'ends_at', c.ends_at, 'location', c.location,
               'capacity', c.max_capacity,
               'left', greatest(0, c.max_capacity - (select count(*) from public.bookings b where b.class_id = c.id and b.status = 'confirmed')))
             order by c.starts_at)
        from public.classes c
       where c.studio_id = v_page.studio_id and c.status = 'scheduled'
         and c.starts_at > now() and c.starts_at < now() + interval '14 days'), '[]'::jsonb)
      else null end
  );
end;
$$;
revoke all on function public.get_public_studio_page(text) from public;
grant execute on function public.get_public_studio_page(text) to anon, authenticated;

-- 10-19. 체험 신청 (로그인 없이). 봇 칸(p_company)이 채워져 있으면 저장하지 않고 성공처럼 답한다
create or replace function public.submit_trial_request(
  p_slug text, p_name text, p_phone text, p_preferred text, p_message text, p_consent boolean, p_company text default null
)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_page   public.studio_pages;
  v_studio public.studios;
  v_phone  text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_name   text := btrim(coalesce(p_name, ''));
  v_req    public.trial_requests;
begin
  select sp.* into v_page from public.studio_pages sp join public.studios s on s.id = sp.studio_id
   where sp.slug = lower(btrim(coalesce(p_slug, ''))) and sp.published and s.closed_at is null;
  if not found then
    raise exception '찾을 수 없는 페이지예요.';
  end if;
  if not v_page.trial_enabled then
    raise exception '지금은 체험 신청을 받지 않아요.';
  end if;
  if nullif(btrim(coalesce(p_company, '')), '') is not null then
    return jsonb_build_object('ok', true);        -- 봇: 저장하지 않음
  end if;
  if not coalesce(p_consent, false) then
    raise exception '개인정보 수집·이용에 동의해 주세요.';
  end if;
  if char_length(v_name) not between 1 and 30 then
    raise exception '이름을 30자 이내로 적어 주세요.';
  end if;
  if v_phone !~ '^0[0-9]{8,11}$' then
    raise exception '연락받을 전화번호를 정확히 적어 주세요. (예: 010-1234-5678)';
  end if;
  if char_length(coalesce(p_preferred, '')) > 100 or char_length(coalesce(p_message, '')) > 500 then
    raise exception '희망 시간은 100자, 남길 말은 500자 이내로 적어 주세요.';
  end if;
  if exists (select 1 from public.trial_requests where studio_id = v_page.studio_id and phone = v_phone and created_at > now() - interval '24 hours') then
    raise exception '이미 신청하셨어요. 스튜디오에서 곧 연락드릴 거예요.';
  end if;
  if (select count(*) from public.trial_requests where studio_id = v_page.studio_id and created_at > now() - interval '1 hour') >= 20
     or (select count(*) from public.trial_requests where created_at > now() - interval '10 minutes') >= 100 then
    raise exception '신청이 많아요. 잠시 후 다시 시도해 주세요.';
  end if;

  insert into public.trial_requests (studio_id, name, phone, preferred, message, consent_at)
  values (v_page.studio_id, v_name, v_phone, nullif(btrim(coalesce(p_preferred, '')), ''), nullif(btrim(coalesce(p_message, '')), ''), now())
  returning * into v_req;

  select * into v_studio from public.studios where id = v_page.studio_id;
  insert into public.notifications (user_id, studio_id, kind, title, body, data)
  select sm.user_id, v_page.studio_id, 'trial_request', '체험 신청 · ' || v_name,
         v_studio.name || ' 소개 페이지에서 체험 수업을 신청했어요.'
           || coalesce(E'\n' || '희망: ' || left(v_req.preferred, 60), ''),
         jsonb_build_object('path', '/trials', 'trial_id', v_req.id)
    from public.studio_members sm
   where sm.studio_id = v_page.studio_id and sm.status = 'active' and sm.role in ('owner', 'manager');

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.submit_trial_request(text, text, text, text, text, boolean, text) from public;
grant execute on function public.submit_trial_request(text, text, text, text, text, boolean, text) to anon, authenticated;

-- 10-20. 체험 신청 처리 (원장·실장)
create or replace function public.update_trial_request(p_id uuid, p_status text, p_memo text default null)
returns public.trial_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_req public.trial_requests;
begin
  select * into v_req from public.trial_requests where id = p_id for update;
  if not found or not public.is_studio_admin(v_req.studio_id) then
    raise exception '원장·실장만 체험 신청을 처리할 수 있습니다.';
  end if;
  if p_status not in ('new', 'contacted', 'scheduled', 'done', 'declined') then
    raise exception '알 수 없는 상태입니다.';
  end if;
  update public.trial_requests
     set status = p_status,
         memo = case when p_memo is null then memo else nullif(left(btrim(p_memo), 500), '') end,
         handled_at = case when p_status = 'new' then null else coalesce(handled_at, now()) end
   where id = p_id
  returning * into v_req;
  return v_req;
end;
$$;
revoke all on function public.update_trial_request(uuid, text, text) from public, anon;
grant execute on function public.update_trial_request(uuid, text, text) to authenticated;

-- 10-21. 운영 종료 시 정리: 페이지 비공개, 체험 신청(비회원 개인정보) 즉시 삭제
create or replace function public.trg_studio_closed_cleanup()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.closed_at is not null and old.closed_at is null then
    update public.studio_pages set published = false, updated_at = now() where studio_id = new.id;
    delete from public.trial_requests where studio_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.trg_studio_closed_cleanup() from public, anon, authenticated;
drop trigger if exists studios_closed_cleanup on public.studios;
create trigger studios_closed_cleanup after update of closed_at on public.studios
  for each row execute function public.trg_studio_closed_cleanup();

-- 10-22. 보관 기간: 체험 신청은 180일 뒤 삭제
create or replace function public.purge_old_trial_requests()
returns integer
language sql security definer set search_path = public
as $$
  with d as (delete from public.trial_requests where created_at < now() - interval '180 days' returning 1)
  select count(*)::int from d;
$$;
revoke execute on function public.purge_old_trial_requests() from public, anon, authenticated;

-- 10-23. 사진 저장소 + 매일 정리 작업 (Supabase 에서만: storage·pg_cron 이 있을 때)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('studio-photos', 'studio-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    drop policy if exists studio_photos_admin_select on storage.objects;
    drop policy if exists studio_photos_admin_insert on storage.objects;
    drop policy if exists studio_photos_admin_update on storage.objects;
    drop policy if exists studio_photos_admin_delete on storage.objects;
    -- 지우기(remove)는 delete + select 권한이 둘 다 있어야 한다 (공개 URL 읽기에는 필요 없음)
    create policy studio_photos_admin_select on storage.objects for select to authenticated
      using (bucket_id = 'studio-photos' and public.is_studio_admin(((storage.foldername(name))[1])::uuid));
    create policy studio_photos_admin_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'studio-photos' and public.is_studio_admin(((storage.foldername(name))[1])::uuid));
    create policy studio_photos_admin_update on storage.objects for update to authenticated
      using (bucket_id = 'studio-photos' and public.is_studio_admin(((storage.foldername(name))[1])::uuid));
    create policy studio_photos_admin_delete on storage.objects for delete to authenticated
      using (bucket_id = 'studio-photos' and public.is_studio_admin(((storage.foldername(name))[1])::uuid));
    raise notice '사진 저장소(studio-photos) 준비 완료';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'purge-trial-requests';
    perform cron.schedule('purge-trial-requests', '30 18 * * *', 'select public.purge_old_trial_requests()');  -- 매일 03:30 KST
    raise notice '체험 신청 180일 보관 정리 작업 예약 완료';
  end if;
end $$;

-- 10-4. 회원 탈퇴
--   막는 경우: ① 내가 유일한 원장인 스튜디오에 다른 사람이 남아 있음  ② 내가 담당인 진행 예정 수업이 있음
--   하는 일:   앞으로의 예약·대기 취소(대기자 자동 확정은 기존 트리거가 처리) → 소속 '탈퇴' 처리·메모 삭제
--             → 푸시 토큰·알림 삭제 → 이름 '탈퇴 회원', 연락처·이메일 삭제
--   이미 탈퇴 처리된 계정이면 아무것도 하지 않는다(로그인 계정 삭제만 다시 시도할 수 있게)
create or replace function public.withdraw_account()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_user      public.users;
  v_blocked   text;
  v_classes   int;
  v_booking   public.bookings;
  v_cancelled int := 0;
  v_solo      uuid;
  v_closed    int := 0;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.';
  end if;
  select * into v_user from public.users where id = v_uid for update;
  if not found then
    raise exception '계정을 찾을 수 없습니다.';
  end if;
  if v_user.withdrawn_at is not null then
    return jsonb_build_object('already', true, 'cancelled_bookings', 0, 'closed_studios', 0);
  end if;

  -- ① 유일한 원장인데 다른 사람이 남은 스튜디오 → 막음
  select string_agg(s.name, ', ' order by s.name) into v_blocked
    from public.studio_members me
    join public.studios s on s.id = me.studio_id
   where me.user_id = v_uid and me.status = 'active' and me.role = 'owner'
     and not exists (select 1 from public.studio_members o
                      where o.studio_id = me.studio_id and o.user_id <> v_uid
                        and o.status = 'active' and o.role = 'owner')
     and exists (select 1 from public.studio_members o
                  where o.studio_id = me.studio_id and o.user_id <> v_uid and o.status = 'active');
  if v_blocked is not null then
    raise exception '다른 원장이 없는 스튜디오가 있어 탈퇴할 수 없어요 (%). 다른 사람을 원장으로 지정하거나, 내 정보에서 스튜디오 운영을 종료한 뒤 다시 시도해 주세요.', v_blocked;
  end if;

  -- ② 혼자 남은 스튜디오(나 말고 아무도 없음) → 함께 운영 종료. 그 스튜디오의 예정 수업도 같이 정리된다
  for v_solo in
    select me.studio_id from public.studio_members me
     where me.user_id = v_uid and me.status = 'active' and me.role = 'owner'
       and not exists (select 1 from public.studio_members o
                        where o.studio_id = me.studio_id and o.user_id <> v_uid and o.status = 'active')
  loop
    perform public._close_studio(v_solo, v_uid, false);
    v_closed := v_closed + 1;
  end loop;

  -- ③ 다른 스튜디오에서 내가 담당인 진행 예정 수업 → 막음
  select count(*) into v_classes
    from public.classes
   where instructor_id = v_uid and status = 'scheduled' and ends_at > now();
  if v_classes > 0 then
    raise exception '담당 중인 진행 예정 수업이 %개 있어요. 폐강하거나 다른 강사로 바꾼 뒤 다시 시도해 주세요.', v_classes;
  end if;

  -- 앞으로의 예약·대기 취소 (본인 취소로 기록 → 본인에게 알림 없음, 대기자는 자동 확정)
  for v_booking in
    select b.* from public.bookings b
      join public.classes c on c.id = b.class_id
     where b.member_id = v_uid and b.status in ('confirmed', 'waitlist') and c.starts_at > now()
     order by c.starts_at
       for update of b
  loop
    update public.bookings
       set status = 'cancelled', pass_refunded = false, cancelled_at = now(), cancelled_by = v_uid
     where id = v_booking.id;
    v_cancelled := v_cancelled + 1;
  end loop;

  update public.studio_members set status = 'left', memo = null where user_id = v_uid;
  delete from public.push_tokens   where user_id = v_uid;
  delete from public.notifications where user_id = v_uid;
  update public.users
     set name = '탈퇴 회원', phone = null, email = null, withdrawn_at = now()
   where id = v_uid;

  return jsonb_build_object('already', false, 'cancelled_bookings', v_cancelled, 'closed_studios', v_closed);
end;
$$;

revoke all on function public.withdraw_account() from public, anon;
grant execute on function public.withdraw_account() to authenticated;

-- 탈퇴한 계정은 초대 코드로 다시 참여할 수 없게 (로그인 계정 삭제가 실패해 로그인이 남아 있는 경우 대비)
create or replace function public._guard_withdrawn_member()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'active' then
    if exists (select 1 from public.users where id = new.user_id and withdrawn_at is not null) then
      raise exception '탈퇴한 계정입니다.';
    end if;
    if exists (select 1 from public.studios where id = new.studio_id and closed_at is not null) then
      raise exception '운영을 종료한 스튜디오입니다.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists studio_members_withdrawn_guard on public.studio_members;
create trigger studio_members_withdrawn_guard
  before insert or update of status on public.studio_members
  for each row execute function public._guard_withdrawn_member();
revoke execute on function public._guard_withdrawn_member() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 11. 이미 가입된 계정의 프로필 채우기 (v1 → v2 로 다시 설치한 경우)
-- -----------------------------------------------------------------------------
insert into public.users (id, email, name, phone)
select id, email, coalesce(raw_user_meta_data ->> 'name', ''), raw_user_meta_data ->> 'phone'
  from auth.users
on conflict (id) do nothing;

-- 10-24. 초대 코드 무작위 대입 막기 (patch 018) — 위 6-2 의 join_studio 를 대체한다
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

-- 10-25. 연락처 공개 범위 (patch 019) — 위 10 의 users 조회 권한을 대체한다
-- 연락처(전화·이메일) 공개 범위 줄이기 (S-04, A안)
--  · 표에서 직접 읽을 수 있는 건 id·이름·가입일·탈퇴 시각뿐. 연락처는 아래 두 함수로만 받는다
--  · 직원(원장·실장·강사)은 지금 소속(active)인 사람의 연락처만. 나간 사람은 이름만 남는다(지난 기록용)
--  · 이메일은 원장·실장만. 강사는 전화번호만
--  · 본인 연락처는 my_contact()
revoke select on public.users from authenticated;
grant select (id, name, created_at, withdrawn_at) on public.users to authenticated;

create or replace function public.studio_contacts(p_studio_id uuid)
returns table (user_id uuid, phone text, email text)
language sql stable security definer set search_path = public
as $$
  select u.id,
         u.phone,
         case when public.is_studio_admin(p_studio_id) then u.email end
    from public.studio_members m
    join public.users u on u.id = m.user_id
   where m.studio_id = p_studio_id
     and m.status = 'active'
     and public.is_studio_staff(p_studio_id);
$$;
revoke all on function public.studio_contacts(uuid) from public, anon;
grant execute on function public.studio_contacts(uuid) to authenticated;

create or replace function public.my_contact()
returns table (phone text, email text)
language sql stable security definer set search_path = public
as $$ select u.phone, u.email from public.users u where u.id = auth.uid(); $$;
revoke all on function public.my_contact() from public, anon;
grant execute on function public.my_contact() to authenticated;
