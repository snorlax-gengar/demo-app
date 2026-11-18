// 보안 점검 (출시 전): Supabase 의 기본 권한(새 표·함수를 anon/authenticated 에 전부 허용)을 재현한 뒤
// schema.sql 을 설치하고, 접근 규칙(RLS)·권한·함수 설정이 의도대로 잠겨 있는지 확인한다.
// usage: node audit.mjs <schema.sql> <out.json>
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const [schemaPath, outPath] = process.argv.slice(2);
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth; create schema extensions;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  create schema net; create table net._calls (id serial, url text, headers jsonb);
  create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}') returns bigint language sql as $$ insert into net._calls(url, headers) values (url, headers) returning id::bigint $$;
`);
await db.exec(fs.readFileSync(schemaPath, 'utf8'));
const q = async (s, p) => (await db.query(s, p)).rows;
const as = async (role, uid, fn) => {
  await db.exec(`select set_config('request.jwt.claim.sub','${uid ?? ''}',false)`);
  await db.exec(`set role ${role}`);
  try { return await fn(); } finally { await db.exec('reset role'); }
};
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
for (const [n, name] of [[1, '원장'], [2, '회원'], [3, '다른회원']])
  await q(`insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)`, [U(n), `${n}@t.dev`, JSON.stringify({ name })]);
const S = (await as('authenticated', U(1), () => q(`select * from create_studio('보안점검')`)))[0];
await as('authenticated', U(2), () => q(`select join_studio($1)`, [S.invite_code]));
await as('authenticated', U(1), () => q(`select issue_pass($1,$2,'group','10회',10,current_date,current_date+30)`, [S.id, U(2)]));

const results = [];
const tc = async (id, title, expected, fn) => {
  try { const actual = await fn(); results.push({ id, area: '보안 점검', title, expected, actual: actual ?? '기대와 같음', pass: true, ms: 0 }); console.log('PASS', id, actual ?? ''); }
  catch (e) { results.push({ id, area: '보안 점검', title, expected, actual: String(e.message).split('\n')[0], pass: false, ms: 0 }); console.log('FAIL', id, e.message); }
};
const tables = (await q(`select c.relname, c.relkind, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v') order by 1`));

await tc('TC-S01', '모든 표에 행 단위 접근 규칙(RLS)이 켜져 있다', 'RLS 꺼진 표 0개', async () => {
  const off = tables.filter((t) => t.relkind === 'r' && !t.relrowsecurity).map((t) => t.relname);
  assert.deepEqual(off, []);
  return `표 ${tables.filter((t) => t.relkind === 'r').length}개 모두 RLS 켜짐`;
});

await tc('TC-S02', 'Supabase 기본 권한이 있어도 로그인하지 않은 사용자(anon)는 어떤 표·뷰도 읽거나 쓸 수 없다', '권한 0개, 표마다 조회 시 거절', async () => {
  const grants = await q(`select table_name, privilege_type from information_schema.role_table_grants where grantee='anon' and table_schema='public'`);
  assert.deepEqual(grants, []);
  let denied = 0;
  for (const t of tables) {
    await assert.rejects(as('anon', null, () => q(`select * from public.${t.relname} limit 1`)), /permission denied/);
    denied++;
  }
  return `anon 권한 0개, ${denied}개 표·뷰 조회 모두 거절`;
});

await tc('TC-S03', '로그인 사용자의 직접 쓰기 권한은 의도한 곳뿐이다 (나머지는 함수로만 변경)', '표 단위 쓰기: classes(추가·수정)만 / 열 단위 수정: pass_products(상품 정보)·users(name,phone)·studios(name)·studio_members(memo)', async () => {
  const t = await q(`select table_name, string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants
                      where grantee='authenticated' and table_schema='public' and privilege_type <> 'SELECT' group by 1 order by 1`);
  assert.deepEqual(t, [{ table_name: 'classes', p: 'INSERT,UPDATE' }]);
  const c = await q(`select table_name, string_agg(column_name, ',' order by column_name) cols from information_schema.column_privileges
                      where grantee='authenticated' and table_schema='public' and privilege_type='UPDATE'
                        and table_name <> 'classes' group by 1 order by 1`);
  assert.deepEqual(c, [
    { table_name: 'pass_products', cols: 'class_type,duration_unit,duration_value,is_active,name,price,sort_order,total_count' },
    { table_name: 'studio_members', cols: 'memo' }, { table_name: 'studios', cols: 'name' }, { table_name: 'users', cols: 'name,phone' }]);
  return `표 단위 ${t.map((r) => `${r.table_name}(${r.p})`).join(', ')} / 열 단위 수정 ${c.map((r) => `${r.table_name}(${r.table_name === 'pass_products' ? '상품 정보 8개 열' : r.cols})`).join(', ')} — studio_id·created_by 등은 수정 불가`;
});

await tc('TC-S04', '권한 상승 함수(SECURITY DEFINER)는 모두 search_path 를 고정하고, 비로그인은 하나도 실행할 수 없다', '고정 안 된 함수 0개 / anon 실행 가능 0개', async () => {
  const fns = await q(`select p.proname, coalesce(array_to_string(p.proconfig, ','), '') cfg, has_function_privilege('anon', p.oid, 'execute') anon_x
                         from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef`);
  const loose = fns.filter((f) => !f.cfg.includes('search_path=')).map((f) => f.proname);
  const anonX = fns.filter((f) => f.anon_x).map((f) => f.proname);
  assert.deepEqual(loose, []); assert.deepEqual(anonX, []);
  return `SECURITY DEFINER ${fns.length}개 모두 search_path 고정, anon 실행 0개`;
});

await tc('TC-S05', '내부 함수(_로 시작)·트리거 함수는 로그인 사용자도 직접 부를 수 없다', '로그인 사용자 실행 가능 0개', async () => {
  const fns = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                        where n.nspname='public' and (p.proname like '\\_%' or p.prorettype='trigger'::regtype or p.proname like 'trg\\_%')
                          and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')`);
  assert.deepEqual(fns.map((f) => f.proname), []);
  const n = (await q(`select count(*)::int c from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and (p.proname like '\\_%' or p.prorettype='trigger'::regtype)`))[0].c;
  return `내부·트리거 함수 ${n}개 모두 직접 호출 불가`;
});

await tc('TC-S06', '회원이 앱을 거치지 않고 직접 수강권 횟수·예약·탈퇴 표시·남의 이름을 바꾸려 하면 막힌다', '수강권 수정·예약 추가·withdrawn_at 수정 거절, 남의 이름 수정 0건, 내 이름 수정 1건', async () => {
  const m = U(2);
  await assert.rejects(as('authenticated', m, () => q(`update passes set remaining_count=999`)), /permission denied/);
  await assert.rejects(as('authenticated', m, () => q(`insert into bookings(studio_id,class_id,member_id,status) values ($1,gen_random_uuid(),$2,'confirmed')`, [S.id, m])), /permission denied/);
  await assert.rejects(as('authenticated', m, () => q(`update users set withdrawn_at=now() where id=$1`, [m])), /permission denied/);
  await assert.rejects(as('authenticated', m, () => q(`update studio_members set role='owner' where user_id=$1`, [m])), /permission denied/);
  const other = await as('authenticated', m, () => db.query(`update users set name='해킹' where id=$1`, [U(3)]));
  const mine = await as('authenticated', m, () => db.query(`update users set name='새이름' where id=$1`, [m]));
  assert.equal(other.affectedRows, 0); assert.equal(mine.affectedRows, 1);
  return '수강권·예약·탈퇴 표시·역할 직접 변경 거절, 남의 이름 0건 / 내 이름 1건 수정';
});

await tc('TC-S07', '회원은 다른 회원의 개인정보(이름·연락처)·수강권·결제를 볼 수 없다', '다른 회원 프로필 0건, 남의 수강권 0건, 결제 0건(원장만)', async () => {
  const m = U(3);
  await as('authenticated', m, () => q(`select join_studio($1)`, [S.invite_code]));
  const r = await as('authenticated', m, async () => ({
    users: (await q(`select count(*)::int c from users where id <> $1`, [m]))[0].c,
    passes: (await q(`select count(*)::int c from passes where member_id <> $1`, [m]))[0].c,
    pays: (await q(`select count(*)::int c from pass_payments`))[0].c,
  }));
  assert.deepEqual(r, { users: 0, passes: 0, pays: 0 });
  return `같은 스튜디오 회원끼리 프로필 ${r.users}·수강권 ${r.passes}·결제 ${r.pays}건`;
});

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
fs.writeFileSync(outPath, JSON.stringify({ results }, null, 2));
process.exit(passed === results.length ? 0 : 1);
