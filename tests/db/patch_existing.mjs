// 수동으로 확인하지 못한 기능에 대한 DB 테스트 케이스 (실제 supabase/schema.sql 을 메모리 Postgres 에 설치해 검증)
// usage: node cases.mjs <schema.sql> <out.json> [patch.sql]
//   patch 를 주면 "패치 적용 전 schema(old)" 로 설치 → 기록 생성 → 패치 실행 후 정리 결과를 검증(TC-D27)
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const [schemaPath, outPath, patchPath] = process.argv.slice(2);
const db = new PGlite({ extensions: { btree_gist } });
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth; create schema extensions;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`);
await db.exec(fs.readFileSync(schemaPath, 'utf8'));

const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const P = { owner: U(1), manager: U(2), t1: U(3), t2: U(4), ownerB: U(5), m: [U(11), U(12), U(13), U(14), U(15), U(16)] };
const names = { [P.owner]: '원장', [P.manager]: '실장', [P.t1]: '강사1', [P.t2]: '강사2', [P.ownerB]: 'B원장' };
P.m.forEach((id, i) => (names[id] = `회원${i + 1}`));
for (const [id, name] of Object.entries(names))
  await db.query(`insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)`, [id, `${id.slice(-2)}@t.dev`, JSON.stringify({ name })]);

const q = async (sql, p) => (await db.query(sql, p)).rows;
const as = (uid) => db.exec(`select set_config('request.jwt.claim.sub','${uid ?? ''}',false)`);
const asRole = async (uid, fn) => { await as(uid); await db.exec(`set role authenticated`); try { return await fn(); } finally { await db.exec(`reset role`); await as(null); } };
const rpc = (uid, sql, p) => asRole(uid, () => q(sql, p));
const rejects = (p, re) => assert.rejects(p, re);

// ---------- 공통 준비 ----------
const A = (await rpc(P.owner, `select * from create_studio('테스트 필라테스')`))[0];
const B = (await rpc(P.ownerB, `select * from create_studio('다른 스튜디오')`))[0];
for (const id of [P.manager, P.t1, P.t2, ...P.m]) await rpc(id, `select * from join_studio($1)`, [A.invite_code]);
await rpc(P.owner, `select * from set_member_role($1,$2,'manager')`, [A.id, P.manager]);
await rpc(P.owner, `select * from set_member_role($1,$2,'instructor')`, [A.id, P.t1]);
await rpc(P.owner, `select * from set_member_role($1,$2,'instructor')`, [A.id, P.t2]);

const issue = async (member, type, n, { starts = 'current_date', expires = 'current_date + 60' } = {}) =>
  (await asRole(P.owner, () => q(`select * from issue_pass($1,$2,$3,'테스트권',$4,${starts},${expires})`, [A.id, member, type, n])))[0];
// 수업은 관리자 권한(테스트 하네스)으로 직접 만든다. minutes: 지금부터 몇 분 뒤 시작
let slot = 0;
const mkClass = async (instr, minutes, cap, title) => {
  slot += 1;
  return (await q(
    `insert into classes(studio_id,title,instructor_id,starts_at,ends_at,max_capacity)
     values ($1,$2,$3, now() + make_interval(mins => $4) + make_interval(secs => $6), now() + make_interval(mins => $4 + 50) + make_interval(secs => $6), $5) returning *`,
    [A.id, title, instr, minutes, cap, slot]))[0];
};
const book = async (uid, cls, member) => (await rpc(uid, `select * from book_class($1,$2)`, [cls, member ?? null]))[0];
const cancel = async (uid, booking, refund) => (await rpc(uid, `select * from cancel_booking($1,$2)`, [booking, refund ?? null]))[0];
const rem = async (member, type) => (await q(`select coalesce(sum(remaining_count),0)::int r from passes where studio_id=$1 and member_id=$2 and class_type=$3`, [A.id, member, type]))[0].r;
const lastLog = async (member) => (await q(`select l.*, u.name actor_name from pass_logs l left join users u on u.id=l.actor_id where l.member_id=$1 order by l.id desc limit 1`, [member]))[0];
const status = async (bookingId) => (await q(`select status from bookings where id=$1`, [bookingId]))[0].status;

const [m1, m2, m3, m4, m5, m6] = P.m;
await issue(m1, 'private', 10);
for (const m of [m1, m2, m3, m4]) await issue(m, 'group', 20);
await issue(m5, 'group', 1); // 승격 시 수강권 소진 시나리오용
// m6: 수강권 없음


const c = await mkClass(P.t1, 3 * 24 * 60 + 600, 1 + 1, '기존 기록');
const x = await book(m1, c.id); await book(m2, c.id); await book(m3, c.id);
await cancel(P.owner, x.id);
const before = await lastLog(m3);
await db.exec(fs.readFileSync(patchPath, 'utf8'));
const after = (await q(`select actor_id, memo from pass_logs where id=$1`, [before.id]))[0];
assert.equal(before.reason, 'waitlist_promotion'); assert.equal(before.actor_name, '원장');
assert.equal(after.actor_id, null); assert.match(after.memo, /자동 확정/);
const res = { id: 'TC-D29', area: '자동 승격', title: '패치 005 실행 시 이미 쌓인 자동 승격 기록도 처리자가 정리된다', expected: '패치 전 처리자 "원장" → 패치 후 없음 + 자동 확정 메모', actual: `패치 전 처리자 ${before.actor_name} → 패치 후 ${after.actor_id ?? '없음(자동)'}, 메모 "${after.memo}"`, pass: true, ms: 0 };
console.log('PASS', res.id, res.actual);
fs.writeFileSync(outPath, JSON.stringify({ results: [res] }, null, 2));
