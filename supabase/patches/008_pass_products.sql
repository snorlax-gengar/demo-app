-- =============================================================================
-- 008: 수강권 상품(스튜디오별 가격표)
-- -----------------------------------------------------------------------------
-- 원장·실장이 '리포머 그룹 20회 / 3개월 / 480,000원' 같은 상품을 등록해 두면
-- 수강권 발급 화면에서 골라 유형·횟수·기간·금액이 자동으로 채워진다.
-- 실행: Supabase SQL Editor 에서 이 파일 전체를 한 번 실행. (다시 실행해도 안전)
-- =============================================================================

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
