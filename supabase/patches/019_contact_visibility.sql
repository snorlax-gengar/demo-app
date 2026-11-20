-- 019: 나간 회원 연락처 숨기기 · 강사에게 이메일 숨기기 (2026-11-20 출시 전 보안 점검 S-04, A안)
-- 앱은 이 패치와 같이 바뀐 버전(커밋 이후 빌드)을 써야 한다: 예전 앱은 회원 목록에서 users(*) 를 읽다가 권한 오류가 난다.
-- 여러 번 실행해도 안전하다.

-- 연락처(전화·이메일) 공개 범위 줄이기 (S-04, A안)
--  · 표에서 직접 읽을 수 있는 건 id·이름·가입일·탈퇴 시각뿐. 연락처는 아래 두 함수로만 받는다
--  · 직원(원장·실장·강사)은 지금 소속(active)인 사람의 연락처만. 나간 사람은 이름만 남는다(지난 기록용)
--  · 이메일은 원장·실장만. 강사는 전화번호만
--  · 본인 연락처는 my_contact()
revoke select on public.users from authenticated;
grant select (id, name, created_at, withdrawn_at) on public.users to authenticated;

create or replace function public.studio_contacts(p_studio_id uuid)
returns table (user_id uuid, phone text, email text)
language sql stable security definer set search_path = public
as $$
  select u.id,
         u.phone,
         case when public.is_studio_admin(p_studio_id) then u.email end
    from public.studio_members m
    join public.users u on u.id = m.user_id
   where m.studio_id = p_studio_id
     and m.status = 'active'
     and public.is_studio_staff(p_studio_id);
$$;
revoke all on function public.studio_contacts(uuid) from public, anon;
grant execute on function public.studio_contacts(uuid) to authenticated;

create or replace function public.my_contact()
returns table (phone text, email text)
language sql stable security definer set search_path = public
as $$ select u.phone, u.email from public.users u where u.id = auth.uid(); $$;
revoke all on function public.my_contact() from public, anon;
grant execute on function public.my_contact() to authenticated;
