-- =============================================================================
-- 009: 발급 후 결제 추가
-- -----------------------------------------------------------------------------
-- 수강권을 먼저 발급하고 돈은 나중에 받은 경우, 나눠서 받은 경우에 결제를 추가로 기록한다.
-- 원장·관리자만 추가 가능(결제 목록 조회는 지금처럼 원장만). 결제일은 오늘(한국)까지, 1년 이내.
-- 실행: Supabase SQL Editor 에서 이 파일 전체를 한 번 실행. (다시 실행해도 안전)
-- =============================================================================

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

revoke execute on function public.add_pass_payment(uuid, int, text, date, text) from public, anon;
grant execute on function public.add_pass_payment(uuid, int, text, date, text) to authenticated;
