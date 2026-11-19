-- 패치 013: classes 직접 UPDATE 보안 강화 (열 단위 권한 제한 + 시작/폐강 수업 수정 가드)
-- 이미 운영 중인 DB 에 1회 실행합니다 (여러 번 실행해도 안전).
--
-- 보완 내용:
--   1. authenticated 의 classes UPDATE 권한을 status/studio_id/created_at 이 제외된 6개 열로 제한
--      → cancel_class() RPC 를 우회해 수강권 복구 없이 status='cancelled' 로 직접 바꾸는 것을 차단
--   2. guard_class_update() 트리거 강화
--      → 폐강된 수업 수정 금지, 이미 시작된 수업의 시간·강사·정원 변경 금지, 과거 시간으로 변경 금지

revoke update on public.classes from authenticated;
grant update (title, instructor_id, starts_at, ends_at, max_capacity, location) on public.classes to authenticated;

create or replace function public.guard_class_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_seated int;
  v_active int;
begin
  if old.status = 'cancelled' then
    if auth.uid() is not null and new.status = 'scheduled' then
      raise exception '폐강된 수업은 되살릴 수 없습니다. 새로 등록해 주세요.';
    end if;
    raise exception '폐강된 수업은 수정할 수 없습니다.';
  end if;

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

revoke execute on function public.guard_class_update() from public, anon, authenticated;
