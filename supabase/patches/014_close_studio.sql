-- =============================================================================
-- 014: 스튜디오 운영 종료 + 원장 탈퇴 보완
-- -----------------------------------------------------------------------------
-- 1) close_studio(): 원장이 스튜디오를 닫는다
--      앞으로의 수업 폐강(수강권 횟수 복구) → 회원·직원에게 "운영 종료" 알림 1건씩(수업별 폐강 알림은 생략)
--      → 모든 소속을 '탈퇴' 처리 → 초대 코드로 다시 들어올 수 없음. 예약·출석·결제 기록은 그대로 남는다.
-- 2) close_studio_preview(): 종료 전에 영향 범위(폐강될 수업·취소될 예약·알림 받을 사람) 미리 보기
-- 3) withdraw_account(): 혼자 남은 스튜디오의 원장이 탈퇴하면 그 스튜디오도 함께 운영 종료
--      (아무도 들어갈 수 없는 스튜디오가 남지 않게). 다른 사람이 남아 있으면 지금처럼 막되,
--      "다른 원장 지정 또는 운영 종료" 를 안내한다.
-- 다시 실행해도 안전합니다.
-- =============================================================================

alter table public.studios add column if not exists closed_at timestamptz;
alter table public.studios add column if not exists closed_by uuid references public.users (id) on delete set null;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('booked_by_staff', 'waitlisted_by_staff', 'promoted', 'cancelled_by_staff', 'class_cancelled', 'reminder', 'studio_closed'));

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

-- 10-6. 스튜디오 운영 종료 (원장만). 실수 방지로 스튜디오 이름을 정확히 입력해야 한다
create or replace function public.close_studio(p_studio_id uuid, p_confirm_name text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_name text;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if coalesce(public.studio_role(p_studio_id), '') <> 'owner' then
    raise exception '원장만 스튜디오 운영을 종료할 수 있습니다.';
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

-- 10-7. 운영 종료 미리 보기 (원장만)
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
    'members',  (select count(*) from public.studio_members where studio_id = p_studio_id and status = 'active' and user_id <> auth.uid())
  );
end;
$$;
revoke all on function public.close_studio_preview(uuid) from public, anon;
grant execute on function public.close_studio_preview(uuid) to authenticated;

-- 운영 종료한 스튜디오에는 초대 코드로도 다시 들어올 수 없게 (탈퇴 계정 차단과 같은 트리거)
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
revoke execute on function public._guard_withdrawn_member() from public, anon, authenticated;

-- 10-4. 회원 탈퇴 (014 보완: 혼자 남은 스튜디오는 함께 운영 종료)
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
