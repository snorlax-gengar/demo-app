-- =============================================================================
-- 패치 016: 스튜디오 소개 페이지(공개 링크 piq.expo.app/s/<주소이름>) + 체험 수업 신청
--
--  · studio_pages: 원장·실장이 앱에서 쓰는 소개 페이지 (소개글·사진·위치·연락처·운영 시간·공개 여부)
--  · get_public_studio_page(주소이름): 누구나(로그인 없이) 공개된 페이지 + 앞으로 14일 시간표를 읽는다
--    (회원·강사 이름, 초대 코드, 예약자 정보는 내보내지 않음)
--  · submit_trial_request: 비회원이 체험 수업을 신청 → 원장·실장에게 앱 알림·푸시
--    (개인정보 동의 필수, 같은 번호 24시간 1번, 스튜디오당 시간당 20건, 전체 10분 100건 제한, 봇 칸)
--  · 체험 신청 기록은 180일 뒤 자동 삭제, 스튜디오 운영 종료 시 즉시 삭제·페이지 비공개
--  · 사진: Storage 공개 버킷 studio-photos/<studio_id>/… (원장·실장만 올리고 지움, 5MB, jpg/png/webp)
--
-- 015 적용 후 Supabase SQL Editor 에서 한 번 실행. 여러 번 실행해도 안전.
-- =============================================================================

-- 1) 알림 종류 추가
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'booked_by_staff', 'waitlisted_by_staff', 'promoted', 'cancelled_by_staff', 'class_cancelled', 'reminder',
  'studio_closed', 'close_request_new', 'close_request_approved', 'close_request_rejected', 'trial_request'));

-- 2) 소개 페이지
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

-- 3) 체험 신청
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

-- 4) 페이지 저장 (원장·실장). 처음 저장할 때 만들어지고, 이후엔 고친다
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

-- 5) 공개 페이지 읽기 (로그인 없이). 공개 중이고 운영 중인 스튜디오만
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

-- 6) 체험 신청 (로그인 없이). 봇 칸(p_company)이 채워져 있으면 저장하지 않고 성공처럼 답한다
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

-- 7) 체험 신청 처리 (원장·실장)
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

-- 8) 운영 종료 시 정리: 페이지 비공개, 체험 신청(비회원 개인정보) 즉시 삭제
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

-- 9) 보관 기간: 체험 신청은 180일 뒤 삭제
create or replace function public.purge_old_trial_requests()
returns integer
language sql security definer set search_path = public
as $$
  with d as (delete from public.trial_requests where created_at < now() - interval '180 days' returning 1)
  select count(*)::int from d;
$$;
revoke execute on function public.purge_old_trial_requests() from public, anon, authenticated;

-- 10) 사진 저장소 + 매일 정리 작업 (Supabase 에서만: storage·pg_cron 이 있을 때)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('studio-photos', 'studio-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    drop policy if exists studio_photos_admin_insert on storage.objects;
    drop policy if exists studio_photos_admin_update on storage.objects;
    drop policy if exists studio_photos_admin_delete on storage.objects;
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
