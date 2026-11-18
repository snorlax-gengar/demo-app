-- =============================================================================
-- 006: 직원의 예약 관리 범위를 수업 단위로 제한
-- -----------------------------------------------------------------------------
-- 문제: 강사가 다른 강사 수업의 회원 예약도 취소(기본 횟수 복구)·대신 예약할 수 있었다.
-- 수정: 원장·실장은 모든 수업, 강사는 본인 담당 수업의 예약만 취소·대신 예약할 수 있다.
--       회원 본인의 예약·취소는 그대로.
-- 실행: Supabase SQL Editor 에서 이 파일 전체를 한 번 실행. (schema.sql 은 다시 실행하지 않아도 됨)
-- =============================================================================

create or replace function public._can_manage_class(p_class public.classes)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.studio_role(p_class.studio_id), '') in ('owner', 'manager')
      or (public.studio_role(p_class.studio_id) = 'instructor' and p_class.instructor_id = auth.uid());
$$;

revoke execute on function public._can_manage_class(public.classes) from public, anon, authenticated;

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
