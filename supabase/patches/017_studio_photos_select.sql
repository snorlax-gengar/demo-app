-- 017: 소개 페이지 사진을 지워도 저장소에 파일이 남던 문제 (F-10, 2026-11-20 실서버 테스트에서 발견)
-- Supabase Storage 의 지우기(remove)는 객체에 대한 delete 와 select 권한이 둘 다 있어야 하는데,
-- 016 에는 select 정책이 없어 원장·실장이 사진을 지워도 파일이 그대로 남았다.
-- 원장·실장이 자기 스튜디오 폴더(<studio_id>/...)의 파일만 조회할 수 있게 한다. (공개 URL 로 보는 데에는 영향 없음)
-- 여러 번 실행해도 안전하다.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    drop policy if exists studio_photos_admin_select on storage.objects;
    create policy studio_photos_admin_select on storage.objects for select to authenticated
      using (bucket_id = 'studio-photos' and public.is_studio_admin(((storage.foldername(name))[1])::uuid));
    raise notice 'studio-photos 조회 정책 추가 완료 (사진 지우기 정상화)';
  end if;
end $$;

-- 확인: 4개(select·insert·update·delete)가 나와야 한다
select policyname, cmd from pg_policies where schemaname = 'storage' and policyname like 'studio_photos_admin_%' order by policyname;
