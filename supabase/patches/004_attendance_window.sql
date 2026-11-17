-- =============================================================================
-- 패치 004 — 출석·노쇼 처리 시점 제한
-- 지금 쓰는 DB(v2 + 패치 003)에 1회 실행하세요. 새로 설치하면 schema.sql 에 포함돼 있습니다.
--
--   · 출석(attended) : 수업 시작 30분 전부터 (일찍 온 회원 체크인)
--   · 노쇼(no_show)  : 수업이 시작된 뒤에만
--   · 되돌리기(confirmed) : 언제나 (잘못 누른 것 취소)
--   시간을 바꾸려면 아래 '30 minutes' 와 앱의 lib/attendance.ts CHECKIN_OPEN_MINUTES 를 함께 바꾸세요.
--
-- 함수 이름·인자가 같아서 기존 권한(GRANT)은 그대로 유지됩니다.
-- =============================================================================

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
