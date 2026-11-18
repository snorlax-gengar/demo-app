-- =============================================================================
-- 012: 회원 탈퇴 — 개인정보는 지우고, 예약·결제·출석 기록은 '탈퇴 회원'으로 남긴다
-- -----------------------------------------------------------------------------
-- 앱의 '회원 탈퇴' → Edge Function delete-account → withdraw_account() 실행 → 로그인 계정 삭제(소프트 삭제)
-- auth.users 줄을 실제로 지우면 users → 수강권·예약·결제가 연쇄 삭제되므로, 로그인 계정은 소프트 삭제만 한다
-- (Supabase 가 이메일을 알아볼 수 없게 바꾸고 로그인을 막는다. 같은 이메일로 새로 가입은 가능).
-- 다시 실행해도 안전합니다.
-- =============================================================================

alter table public.users add column if not exists withdrawn_at timestamptz;

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
  v_uid      uuid := auth.uid();
  v_user     public.users;
  v_blocked  text;
  v_classes  int;
  v_booking  public.bookings;
  v_cancelled int := 0;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다.';
  end if;
  select * into v_user from public.users where id = v_uid for update;
  if not found then
    raise exception '계정을 찾을 수 없습니다.';
  end if;
  if v_user.withdrawn_at is not null then
    return jsonb_build_object('already', true, 'cancelled_bookings', 0);
  end if;

  -- ① 유일한 원장 + 다른 사람이 남은 스튜디오
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
    raise exception '다른 원장이 없는 스튜디오가 있어 탈퇴할 수 없어요 (%). 다른 사람을 원장으로 지정한 뒤 다시 시도해 주세요.', v_blocked;
  end if;

  -- ② 내가 담당인 진행 예정 수업
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

  -- 소속: 탈퇴 처리 + 스튜디오가 남긴 메모(부상 이력 등) 삭제
  update public.studio_members set status = 'left', memo = null where user_id = v_uid;

  delete from public.push_tokens   where user_id = v_uid;
  delete from public.notifications where user_id = v_uid;

  update public.users
     set name = '탈퇴 회원', phone = null, email = null, withdrawn_at = now()
   where id = v_uid;

  return jsonb_build_object('already', false, 'cancelled_bookings', v_cancelled);
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
  if new.status = 'active' and exists (select 1 from public.users where id = new.user_id and withdrawn_at is not null) then
    raise exception '탈퇴한 계정입니다.';
  end if;
  return new;
end;
$$;

drop trigger if exists studio_members_withdrawn_guard on public.studio_members;
create trigger studio_members_withdrawn_guard
  before insert or update of status on public.studio_members
  for each row execute function public._guard_withdrawn_member();
revoke execute on function public._guard_withdrawn_member() from public, anon, authenticated;
