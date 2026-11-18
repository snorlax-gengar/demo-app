// 패치 007 검증: 예전 schema(기본값 current_date=UTC) 로 쌓인 '한국 오전 9시 전' 결제일이 한국 날짜로 보정되는지
// usage: node patch007.mjs <예전 schema.sql> <out.json> <007 patch.sql>
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
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  set timezone = 'UTC';
`);
await db.exec(fs.readFileSync(schemaPath, 'utf8'));
const q = async (sql, p) => (await db.query(sql, p)).rows;
const O = '00000000-0000-0000-0000-000000000001', M = '00000000-0000-0000-0000-000000000002';
await q(`insert into auth.users(id,email,raw_user_meta_data) values ($1,'o@t.dev','{"name":"원장"}'),($2,'m@t.dev','{"name":"회원"}')`, [O, M]);
await db.exec(`select set_config('request.jwt.claim.sub','${O}',false)`);
const S = (await q(`select * from create_studio('보정 테스트')`))[0];
await q(`insert into studio_members(studio_id,user_id,role) values ($1,$2,'member')`, [S.id, M]);
const pass = (await q(`select * from issue_pass($1,$2,'group','권',10,'2026-11-01','2026-12-31',null,null,null)`, [S.id, M]))[0];
// 예전 기본값으로 들어간 것과 같은 행: 한국 11/18 08:30(UTC 11/17 23:30) 결제 → paid_on 11/17 / 한국 11/18 15:00(UTC 06:00) 결제 → 11/18
await q(`insert into pass_payments(studio_id,pass_id,member_id,amount,paid_on,created_at) values
  ($1,$2,$3,100000,'2026-11-17','2026-11-17 23:30:00+00'),
  ($1,$2,$3,200000,'2026-11-18','2026-11-18 06:00:00+00'),
  ($1,$2,$3,300000,'2026-11-10','2026-11-17 23:40:00+00')`, [S.id, pass.id, M]);
await db.exec(fs.readFileSync(patchPath, 'utf8'));
const rows = await q(`select amount, paid_on::text d from pass_payments order by amount`);
assert.deepEqual(rows.map((r) => r.d), ['2026-11-18', '2026-11-18', '2026-11-10']);
const res = { id: 'TC-D36', area: '매출', title: '패치 007 실행 시 한국 오전 9시 전 결제의 날짜가 한국 날짜로 보정된다 (직접 입력한 날짜는 그대로)',
  expected: '08:30 결제 11/17→11/18, 15:00 결제 11/18 유지, 다른 날짜로 입력된 결제 유지', pass: true, ms: 0,
  actual: `08:30 결제 ${rows[0].d}, 15:00 결제 ${rows[1].d}, 별도 날짜 결제 ${rows[2].d}` };
console.log('PASS', res.id, res.actual);
fs.writeFileSync(outPath, JSON.stringify({ results: [res] }, null, 2));
