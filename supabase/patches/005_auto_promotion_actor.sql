-- =============================================================================
-- 005: 대기 자동 승격 기록의 '처리자' 표기 수정
-- -----------------------------------------------------------------------------
-- 문제: 대기자가 자동 승격되면 수강권 변동 내역에 빈자리를 만든 사람(예: 예약을 취소한 원장)이
--       처리자로 기록됐다.
-- 수정: 자동 승격 기록은 처리자를 비우고(null) 메모 '빈자리가 생겨 대기 순번대로 자동 확정'을 남긴다.
--       앱에서는 '대기 승격 차감 · 자동' 으로 보인다.
-- 실행: Supabase SQL Editor 에서 이 파일 전체를 한 번 실행. (schema.sql 은 다시 실행하지 않아도 됨)
--       기존 기록도 함께 정리한다(맨 아래 update).
-- =============================================================================

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

-- 이미 쌓인 자동 승격 기록 정리
update public.pass_logs
   set actor_id = null,
       memo = coalesce(memo, '빈자리가 생겨 대기 순번대로 자동 확정')
 where reason = 'waitlist_promotion' and actor_id is not null;
