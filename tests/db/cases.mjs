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
// pg_net 대역: http_post 호출을 기록만 한다
await db.exec(`create schema net; create table net._calls (id serial, url text, headers jsonb, at timestamptz default now());
  create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}') returns bigint language sql as
  $$ insert into net._calls(url, headers) values (url, headers) returning id::bigint $$;`);
await db.exec(fs.readFileSync(schemaPath, 'utf8'));
if (patchPath) await db.exec(fs.readFileSync(patchPath, 'utf8'));

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

// ---------- 테스트 케이스 ----------
const results = [];
const tc = async (id, area, title, expected, fn) => {
  const t0 = Date.now();
  try {
    const actual = await fn();
    results.push({ id, area, title, expected, actual: actual ?? '기대와 같음', pass: true, ms: Date.now() - t0 });
    console.log(`PASS ${id} ${title}`);
  } catch (e) {
    results.push({ id, area, title, expected, actual: String(e.message).split('\n')[0], pass: false, ms: Date.now() - t0 });
    console.log(`FAIL ${id} ${title}\n  ${e.message}`);
  }
};

// 1) 1:1 예약
const priv = await mkClass(P.t1, 3 * 24 * 60, 1, '1:1 개인');
let privBooking;
await tc('TC-D01', '1:1 예약', '1:1 수업 첫 예약은 확정되고 1:1 수강권이 1회 차감된다', '확정, 1:1 잔여 10→9', async () => {
  privBooking = await book(m1, priv.id);
  assert.equal(privBooking.status, 'confirmed');
  assert.equal(await rem(m1, 'private'), 9);
  return `상태 ${privBooking.status}, 1:1 잔여 ${await rem(m1, 'private')}회`;
});
await tc('TC-D02', '1:1 예약', '1:1 수업이 찼으면 두 번째 회원은 대기 없이 거절된다', '"이미 예약이 마감된 1:1 수업" 오류, 대기 생성 안 됨', async () => {
  await issue(m2, 'private', 5);
  await rejects(book(m2, priv.id), /이미 예약이 마감된 1:1 수업/);
  const n = (await q(`select count(*)::int c from bookings where class_id=$1 and member_id=$2`, [priv.id, m2]))[0].c;
  assert.equal(n, 0);
  return '거절됨, 대기 0건';
});
await tc('TC-D03', '1:1 예약', '그룹 수강권만 있는 회원은 1:1 수업을 예약할 수 없다', '"사용 가능한 1:1 개인 수강권이 없습니다"', async () => {
  const p2 = await mkClass(P.t1, 3 * 24 * 60 + 120, 1, '1:1 개인 2');
  await rejects(book(m3, p2.id), /사용 가능한 1:1 개인 수강권이 없습니다/);
});

// 2) 그룹 대기
const grp = await mkClass(P.t1, 4 * 24 * 60, 2, '그룹 정원2');
let g1, g2, w3, w5;
await tc('TC-D04', '그룹·대기', '정원이 차면 대기로 등록되고 대기는 차감되지 않는다', '1·2번 확정, 3번 대기, 대기자 잔여 20 유지', async () => {
  g1 = await book(m1, grp.id); g2 = await book(m2, grp.id); w3 = await book(m3, grp.id);
  assert.deepEqual([g1.status, g2.status, w3.status], ['confirmed', 'confirmed', 'waitlist']);
  assert.equal(await rem(m3, 'group'), 20);
  return `확정·확정·대기, 대기자 잔여 ${await rem(m3, 'group')}회`;
});
await tc('TC-D24', '그룹·대기', '같은 수업을 두 번 예약(대기 포함)할 수 없다', '"이미 예약(또는 대기)한 수업" 오류', async () => {
  await rejects(book(m3, grp.id), /이미 예약\(또는 대기\)한 수업/);
});

// 3) 취소 규정
await tc('TC-D05', '취소 규정', '수업 24시간 전까지 본인 취소하면 횟수가 복구된다', '잔여 19→20, 기록 "취소 복구 +1"', async () => {
  const c = await mkClass(P.t2, 30 * 60, 4, '30시간 뒤');
  const b = await book(m4, c.id);
  assert.equal(await rem(m4, 'group'), 19);
  const r = await cancel(m4, b.id);
  assert.equal(r.pass_refunded, true);
  assert.equal(await rem(m4, 'group'), 20);
  const log = await lastLog(m4);
  assert.equal(log.reason, 'cancel_refund'); assert.equal(log.delta, 1);
  return `복구됨, 잔여 ${await rem(m4, 'group')}회, 기록 ${log.reason} +${log.delta}`;
});
await tc('TC-D06', '취소 규정', '24시간 이내 본인 취소는 횟수가 복구되지 않는다', '잔여 20→19 유지, pass_refunded=false', async () => {
  const c = await mkClass(P.t2, 5 * 60, 4, '5시간 뒤');
  const b = await book(m4, c.id);
  const r = await cancel(m4, b.id);
  assert.equal(r.status, 'cancelled'); assert.equal(r.pass_refunded, false);
  assert.equal(await rem(m4, 'group'), 19);
  return `취소됨·미복구, 잔여 ${await rem(m4, 'group')}회`;
});
await tc('TC-D07', '취소 규정', '이미 시작된 수업은 회원이 직접 취소할 수 없다', '"이미 시작된 수업은 취소할 수 없습니다"', async () => {
  const c = await mkClass(P.owner, 90, 4, '곧 시작');
  const b = await book(m4, c.id);
  await q(`update classes set starts_at = now() - interval '5 minutes', ends_at = now() + interval '45 minutes' where id=$1`, [c.id]);
  await rejects(cancel(m4, b.id), /이미 시작된 수업은 취소할 수 없습니다/);
});
await tc('TC-D08', '취소 규정', '직원이 대신 취소하면 기본 복구, 복구 안 함 선택도 가능하다', '기본 취소 +1 복구 / refund=false 는 미복구', async () => {
  const c = await mkClass(P.t2, 3 * 60, 4, '3시간 뒤');
  const b1 = await book(m3, c.id); const b2 = await book(m2, c.id);
  const before3 = await rem(m3, 'group'), before2 = await rem(m2, 'group');
  const r1 = await cancel(P.owner, b1.id);
  const r2 = await cancel(P.manager, b2.id, false);
  assert.equal(r1.pass_refunded, true); assert.equal(await rem(m3, 'group'), before3 + 1);
  assert.equal(r2.pass_refunded, false); assert.equal(await rem(m2, 'group'), before2);
  return `기본 취소: 복구(${before3}→${await rem(m3, 'group')}), 복구 안 함: 유지(${before2}→${await rem(m2, 'group')})`;
});

// 4) 자동 승격
await tc('TC-D09', '자동 승격', '확정자가 취소하면 대기 1순위가 자동 확정·차감되고 기록 처리자는 "자동"', '대기자 확정, 잔여 -1, 처리자 없음(null) + 자동 확정 메모', async () => {
  const before = await rem(m3, 'group');
  await cancel(P.owner, g1.id); // 원장이 회원1 예약을 취소 → 빈자리
  assert.equal(await status(w3.id), 'confirmed');
  assert.equal(await rem(m3, 'group'), before - 1);
  const log = await lastLog(m3);
  assert.equal(log.reason, 'waitlist_promotion');
  assert.equal(log.actor_id, null, `처리자가 ${log.actor_name} 으로 기록됨`);
  assert.match(log.memo ?? '', /자동 확정/);
  return `대기→확정, 잔여 ${before}→${await rem(m3, 'group')}, 처리자 ${log.actor_name ?? '없음(자동)'}, 메모 "${log.memo}"`;
});
await tc('TC-D10', '자동 승격', '대기 1순위가 쓸 수 있는 수강권이 없으면 건너뛰고 다음 대기자를 확정한다', '수강권 없는 대기자는 대기 유지, 다음 대기자 확정', async () => {
  const c = await mkClass(P.t2, 5 * 24 * 60, 1 + 1, '건너뛰기');
  const a = await book(m1, c.id); await book(m2, c.id);
  // 회원5: 그룹 1회권 → 다른 수업 예약으로 소진시킨 뒤 대기 등록
  const wa = await book(m5, c.id); // 대기 1순위
  const wb = await book(m4, c.id); // 대기 2순위
  const other = await mkClass(P.t1, 6 * 24 * 60, 4, '소진용');
  await book(m5, other.id);
  assert.equal(await rem(m5, 'group'), 0);
  await cancel(P.owner, a.id);
  assert.equal(await status(wa.id), 'waitlist');
  assert.equal(await status(wb.id), 'confirmed');
  return '회원5(수강권 0) 대기 유지, 회원4 확정';
});
await tc('TC-D11', '정원·폐강', '정원을 늘리면 대기자가 순서대로 자동 확정된다', '정원 2→3, 대기 1명 확정', async () => {
  const c = await mkClass(P.t1, 7 * 24 * 60, 2, '정원 늘리기');
  await book(m1, c.id); await book(m2, c.id); const w = await book(m3, c.id);
  await rpc(P.owner, `update classes set max_capacity=3 where id=$1`, [c.id]);
  assert.equal(await status(w.id), 'confirmed');
});
await tc('TC-D12', '정원·폐강', '현재 예약 인원보다 정원을 줄일 수 없다', '"현재 예약 인원(2명)보다 정원을 줄일 수 없습니다"', async () => {
  const c = await mkClass(P.t1, 8 * 24 * 60, 4, '줄이기');
  await book(m1, c.id); await book(m2, c.id);
  // 4명 → 2명(예약 인원과 같음)은 허용, 2명 → 1명(예약 인원보다 적음)은 거절
  const ok = await rpc(P.owner, `update classes set max_capacity=2 where id=$1 returning max_capacity`, [c.id]);
  assert.equal(ok[0].max_capacity, 2);
  await rejects(rpc(P.owner, `update classes set max_capacity=1 where id=$1`, [c.id]), /정원을 줄일 수 없습니다/);
  return '2명 예약 상태에서 1명으로 축소 거절, 2명으로는 허용';
});
await tc('TC-D13', '정원·폐강', '예약이 있는 수업은 1:1 ↔ 그룹 유형을 바꿀 수 없다', '"1:1 ↔ 그룹 유형을 바꿀 수 없습니다"', async () => {
  const c = await mkClass(P.t1, 9 * 24 * 60, 1, '1:1→그룹');
  await book(m1, c.id);
  await rejects(rpc(P.owner, `update classes set max_capacity=4 where id=$1`, [c.id]), /1:1 ↔ 그룹 유형을 바꿀 수 없습니다/);
});
await tc('TC-D14', '정원·폐강', '폐강하면 확정자는 복구, 대기자는 취소되고 되살릴 수 없다', '확정 2명 +1 복구(폐강 복구), 대기 취소, 되살리기 거절', async () => {
  const c = await mkClass(P.t1, 10 * 24 * 60, 2, '폐강');
  const b1 = await book(m1, c.id); await book(m2, c.id); const w = await book(m3, c.id);
  const before = await rem(m1, 'group');
  const n = (await rpc(P.owner, `select cancel_class($1) n`, [c.id]))[0].n;
  assert.equal(n, 3);
  assert.equal(await rem(m1, 'group'), before + 1);
  assert.equal((await lastLog(m1)).reason, 'class_cancelled');
  assert.equal(await status(w.id), 'cancelled');
  assert.equal(await status(b1.id), 'cancelled');
  await rejects(rpc(P.owner, `update classes set status='scheduled' where id=$1`, [c.id]), /되살릴 수 없습니다|permission denied/);
  return `정리 ${n}건, 회원1 잔여 ${before}→${await rem(m1, 'group')}, 대기 취소, 되살리기 거절`;
});

// 5) 강사 권한
const t2Class = await mkClass(P.t2, 11 * 24 * 60, 4, '강사2 수업');
await tc('TC-D15', '강사 권한', '강사는 다른 강사의 수업을 폐강할 수 없고, 자기 수업은 폐강할 수 있다', '남의 수업 거절 / 내 수업 성공', async () => {
  await rejects(rpc(P.t1, `select cancel_class($1)`, [t2Class.id]), /담당 강사 또는 원장·관리자만 폐강/);
  const mine = await mkClass(P.t1, 12 * 24 * 60, 4, '강사1 수업');
  await rpc(P.t1, `select cancel_class($1)`, [mine.id]);
  assert.equal((await q(`select status from classes where id=$1`, [mine.id]))[0].status, 'cancelled');
});
await tc('TC-D16', '강사 권한', '강사는 다른 강사의 수업 정원을 바꿀 수 없다', '변경 0건(권한 없음), 정원 그대로', async () => {
  const r = await rpc(P.t1, `update classes set max_capacity=6 where id=$1 returning id`, [t2Class.id]);
  assert.equal(r.length, 0);
  assert.equal((await q(`select max_capacity from classes where id=$1`, [t2Class.id]))[0].max_capacity, 4);
  return '변경 0건, 정원 4명 유지';
});
await tc('TC-D17', '강사 권한', '강사는 수강권을 발급할 수 없다', '"원장 또는 관리자만 수강권을 발급"', async () => {
  await rejects(rpc(P.t1, `select * from issue_pass($1,$2,'group','x',5,current_date,current_date+30)`, [A.id, m6]), /원장 또는 관리자만 수강권을 발급/);
});
await tc('TC-D18', '강사 권한', '강사는 자기 수업 출석만 처리할 수 있다', '남의 수업 거절 / 내 수업(20분 전) 출석 성공', async () => {
  const theirs = await mkClass(P.t2, 20, 4, '강사2 곧 시작');
  const mine = await mkClass(P.t1, 25, 4, '강사1 곧 시작');
  const b1 = await book(m1, theirs.id); const b2 = await book(m2, mine.id);
  await rejects(rpc(P.t1, `select * from mark_attendance($1,'attended')`, [b1.id]), /담당 강사 또는 원장·관리자만 출석/);
  const r = (await rpc(P.t1, `select * from mark_attendance($1,'attended')`, [b2.id]))[0];
  assert.equal(r.status, 'attended');
});

// 6) 대신 예약
await tc('TC-D19', '대신 예약', '원장이 회원 대신 예약하면 확정·차감되고 기록 처리자는 원장', '확정, 잔여 -1, 처리자 "원장"', async () => {
  const c = await mkClass(P.t1, 13 * 24 * 60, 4, '대신 예약');
  const before = await rem(m4, 'group');
  const b = await book(P.owner, c.id, m4);
  assert.equal(b.status, 'confirmed'); assert.equal(b.member_id, m4);
  assert.equal(await rem(m4, 'group'), before - 1);
  const log = await lastLog(m4);
  assert.equal(log.actor_name, '원장');
  return `확정, 잔여 ${before}→${await rem(m4, 'group')}, 처리자 ${log.actor_name}`;
});
await tc('TC-D20', '대신 예약', '강사도 회원 대신 예약할 수 있다(기록 처리자 = 강사)', '확정, 처리자 "강사1"', async () => {
  const c = await mkClass(P.t1, 14 * 24 * 60, 4, '강사 대신 예약');
  const b = await book(P.t1, c.id, m2);
  assert.equal(b.status, 'confirmed');
  assert.equal((await lastLog(m2)).actor_name, '강사1');
});
await tc('TC-D21', '대신 예약', '정원이 찬 수업에 대신 예약하면 대기로 등록된다', '대기, 차감 없음', async () => {
  const c = await mkClass(P.t1, 15 * 24 * 60, 2, '대신 대기');
  await book(m1, c.id); await book(m2, c.id);
  const before = await rem(m3, 'group');
  const b = await book(P.manager, c.id, m3);
  assert.equal(b.status, 'waitlist'); assert.equal(await rem(m3, 'group'), before);
});
await tc('TC-D22', '대신 예약', '직원(강사)을 회원 자리로 예약할 수 없다', '"이 스튜디오의 회원만 예약할 수 있습니다"', async () => {
  const c = await mkClass(P.t1, 16 * 24 * 60, 4, '직원 예약');
  await rejects(book(P.owner, c.id, P.t2), /이 스튜디오의 회원만 예약/);
});
await tc('TC-D23', '대신 예약', '회원은 다른 회원을 대신 예약할 수 없다', '"다른 회원의 예약을 생성할 권한이 없습니다"', async () => {
  const c = await mkClass(P.t1, 17 * 24 * 60, 4, '회원 대리');
  await rejects(book(m1, c.id, m2), /다른 회원의 예약을 생성할 권한/);
});
await tc('TC-D25', '대신 예약', '다른 스튜디오 원장은 이 스튜디오 수업에 예약할 수 없다', '"수업을 찾을 수 없습니다"', async () => {
  const c = await mkClass(P.t1, 18 * 24 * 60, 4, '타 스튜디오');
  await rejects(book(P.ownerB, c.id, m1), /수업을 찾을 수 없습니다/);
});

// 6-2) 수업 단위 직원 권한 (패치 006)
await tc('TC-D30', '강사 권한', '강사는 다른 강사 수업의 회원 예약을 취소할 수 없다', '"담당 강사 또는 원장·관리자만 이 수업의 예약을 취소" 오류, 예약·잔여 그대로', async () => {
  const c = await mkClass(P.t2, 21 * 24 * 60, 4, '강사2 수업(취소 권한)');
  const b = await book(m1, c.id);
  const before = await rem(m1, 'group');
  await rejects(cancel(P.t1, b.id), /담당 강사 또는 원장·관리자만 이 수업의 예약을 취소/);
  assert.equal(await status(b.id), 'confirmed');
  assert.equal(await rem(m1, 'group'), before);
  return `거절됨, 예약 ${await status(b.id)}, 잔여 ${before}회 유지`;
});
await tc('TC-D31', '강사 권한', '강사는 본인 수업의 회원 예약은 취소할 수 있다', '취소 성공, 기본 복구', async () => {
  const c = await mkClass(P.t1, 22 * 24 * 60, 4, '강사1 수업(취소 권한)');
  const b = await book(m2, c.id);
  const r = await cancel(P.t1, b.id);
  assert.equal(r.status, 'cancelled'); assert.equal(r.pass_refunded, true);
});
await tc('TC-D32', '원장 권한', '원장·실장은 어느 강사 수업이든 회원 예약을 취소할 수 있다', '원장·실장 모두 취소 성공', async () => {
  const c = await mkClass(P.t2, 23 * 24 * 60, 4, '강사2 수업(원장 관리)');
  const b1 = await book(m3, c.id); const b2 = await book(m4, c.id);
  assert.equal((await cancel(P.owner, b1.id)).status, 'cancelled');
  assert.equal((await cancel(P.manager, b2.id, false)).status, 'cancelled');
});
await tc('TC-D33', '강사 권한', '강사는 다른 강사 수업에 회원을 대신 예약할 수 없다 (원장은 가능)', '강사 거절 / 원장 성공', async () => {
  const c = await mkClass(P.t2, 24 * 24 * 60, 4, '강사2 수업(대신 예약 권한)');
  await rejects(book(P.t1, c.id, m1), /담당 강사 또는 원장·관리자만 이 수업에 대신 예약/);
  assert.equal((await book(P.owner, c.id, m1)).status, 'confirmed');
});

// 7) 출석 처리 시간
await tc('TC-D26', '출석 시간', '출석은 시작 30분 전부터, 노쇼는 시작 후에만, 되돌리기는 언제나', '40분 전 출석 거절 / 20분 전 출석 OK·노쇼 거절 / 시작 후 노쇼 OK / 되돌리기 OK', async () => {
  const c = await mkClass(P.manager, 40, 4, '출석 시간');
  const b = await book(m1, c.id);
  await rejects(rpc(P.owner, `select * from mark_attendance($1,'attended')`, [b.id]), /30분 전부터/);
  await q(`update classes set starts_at = now() + interval '20 minutes', ends_at = now() + interval '70 minutes' where id=$1`, [c.id]);
  assert.equal((await rpc(P.owner, `select * from mark_attendance($1,'attended')`, [b.id]))[0].status, 'attended');
  await rejects(rpc(P.owner, `select * from mark_attendance($1,'no_show')`, [b.id]), /노쇼는 수업이 시작된 뒤/);
  await q(`update classes set starts_at = now() - interval '10 minutes', ends_at = now() + interval '40 minutes' where id=$1`, [c.id]);
  assert.equal((await rpc(P.owner, `select * from mark_attendance($1,'no_show')`, [b.id]))[0].status, 'no_show');
  assert.equal((await rpc(P.owner, `select * from mark_attendance($1,'confirmed')`, [b.id]))[0].status, 'confirmed');
});
await tc('TC-D27', '수강권 기간', '수업 날짜가 수강권 기간 밖이면 예약할 수 없다', '시작일 전 수업 거절, 기간 안 수업 허용', async () => {
  await issue(m6, 'group', 5, { starts: 'current_date + 10', expires: 'current_date + 40' });
  const early = await mkClass(P.t2, 3 * 24 * 60 + 300, 4, '기간 전');
  await rejects(book(m6, early.id), /수강권이 없습니다/);
  const inside = await mkClass(P.t2, 20 * 24 * 60, 4, '기간 안');
  assert.equal((await book(m6, inside.id)).status, 'confirmed');
});

// 9) 매출 (결제 기록)
await tc('TC-D34', '매출', '결제 기록은 원장만 볼 수 있고 실장·강사·회원에게는 0건', '원장 2건 / 실장·강사·회원 0건', async () => {
  await asRole(P.owner, () => q(`select * from issue_pass($1,$2,'group','매출 테스트권',10,current_date,current_date+60,300000,'card',null)`, [A.id, m6]));
  await asRole(P.manager, () => q(`select * from issue_pass($1,$2,'private','매출 테스트 1:1',5,current_date,current_date+60,250000,'transfer',null)`, [A.id, m6]));
  const seen = {};
  for (const [label, uid] of [['원장', P.owner], ['실장', P.manager], ['강사', P.t1], ['회원', m6]])
    seen[label] = (await asRole(uid, () => q(`select count(*)::int c from pass_payments where studio_id=$1`, [A.id])))[0].c;
  assert.deepEqual(seen, { 원장: 2, 실장: 0, 강사: 0, 회원: 0 });
  return Object.entries(seen).map(([k, v]) => `${k} ${v}건`).join(' · ');
});
await tc('TC-D35', '매출', '결제일 기본값은 한국 날짜다 (UTC 날짜가 아님)', 'paid_on = (now() at time zone Asia/Seoul)::date', async () => {
  const r = (await q(`select paid_on::text p, ((now() at time zone 'Asia/Seoul')::date)::text k from pass_payments where studio_id=$1 order by created_at desc limit 1`, [A.id]))[0];
  assert.equal(r.p, r.k);
  const d = (await q(`select column_default from information_schema.columns where table_name='pass_payments' and column_name='paid_on'`))[0].column_default;
  assert.match(d, /Asia\/Seoul/);
  return `결제일 ${r.p} (한국 날짜 ${r.k}), 기본값 ${d}`;
});

// 10) 수강권 상품 (패치 008)
const addProduct = (uid, v) => rpc(uid, `insert into pass_products(studio_id,name,class_type,total_count,duration_value,duration_unit,price,created_by)
  values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`, [A.id, v.name, v.type, v.count, v.dur, v.unit, v.price ?? null, uid]);
await tc('TC-D37', '수강권 상품', '원장·실장은 상품을 등록·수정·숨김할 수 있다', '원장 등록, 실장 등록·가격 수정·숨김, 목록 2건(숨김 포함)', async () => {
  const a = (await addProduct(P.owner, { name: '리포머 그룹 20회', type: 'group', count: 20, dur: 3, unit: 'month', price: 480000 }))[0];
  const b = (await addProduct(P.manager, { name: '체험 1회', type: 'group', count: 1, dur: 14, unit: 'day', price: 30000 }))[0];
  await rpc(P.manager, `update pass_products set price=450000 where id=$1`, [a.id]);
  await rpc(P.manager, `update pass_products set is_active=false where id=$1`, [b.id]);
  const list = await rpc(P.owner, `select name, price, is_active, duration_unit from pass_products where studio_id=$1 order by created_at`, [A.id]);
  assert.equal(list.length, 2); assert.equal(list[0].price, 450000); assert.equal(list[1].is_active, false); assert.equal(list[1].duration_unit, 'day');
  return list.map((r) => `${r.name}(${r.price.toLocaleString()}원${r.is_active ? '' : ', 숨김'})`).join(', ');
});
await tc('TC-D38', '수강권 상품', '강사·회원·다른 스튜디오 원장은 상품을 볼 수도, 등록할 수도 없다', '조회 0건, 등록 거절', async () => {
  for (const uid of [P.t1, m1, P.ownerB]) {
    const n = (await rpc(uid, `select count(*)::int c from pass_products where studio_id=$1`, [A.id]))[0].c;
    assert.equal(n, 0);
    await rejects(addProduct(uid, { name: 'x', type: 'group', count: 1, dur: 1, unit: 'month' }), /row-level security/);
  }
  return '강사·회원·B원장 조회 0건, 등록 모두 거절';
});
await tc('TC-D39', '수강권 상품', '상품은 삭제할 수 없고(숨김만), 잘못된 값은 저장되지 않는다', '삭제 권한 없음 / 25개월·0회·빈 이름·음수 가격 거절', async () => {
  await rejects(rpc(P.owner, `delete from pass_products where studio_id=$1`, [A.id]), /permission denied/);
  await rejects(addProduct(P.owner, { name: '25개월', type: 'group', count: 10, dur: 25, unit: 'month' }), /check constraint/);
  await rejects(addProduct(P.owner, { name: '0회', type: 'group', count: 0, dur: 1, unit: 'month' }), /check constraint/);
  await rejects(addProduct(P.owner, { name: '  ', type: 'group', count: 1, dur: 1, unit: 'month' }), /check constraint/);
  await rejects(addProduct(P.owner, { name: '음수', type: 'group', count: 1, dur: 1, unit: 'month', price: -1 }), /check constraint/);
  await rejects(rpc(P.manager, `update pass_products set studio_id=$2 where studio_id=$1`, [A.id, B.id]), /permission denied/);
});

// 11) 발급 후 결제 추가 (패치 009)
await tc('TC-D40', '결제 추가', '원장·실장은 발급된 수강권에 결제를 추가할 수 있고, 매출(원장 조회)에 잡힌다', '실장 150,000원(이체, 어제) 추가 → 원장 조회 1건, 결제일·작성자 기록', async () => {
  const pass = (await q(`select id from passes where studio_id=$1 and member_id=$2 order by created_at limit 1`, [A.id, m1]))[0];
  const r = (await rpc(P.manager, `select * from add_pass_payment($1,150000,'transfer',(now() at time zone 'Asia/Seoul')::date - 1,'잔금')`, [pass.id]))[0];
  const seen = await rpc(P.owner, `select amount, method, paid_on::text d, memo, created_by from pass_payments where id=$1`, [r.id]);
  assert.equal(seen.length, 1); assert.equal(seen[0].amount, 150000); assert.equal(seen[0].created_by, P.manager); assert.equal(seen[0].memo, '잔금');
  const mgr = await rpc(P.manager, `select count(*)::int c from pass_payments where id=$1`, [r.id]);
  assert.equal(mgr[0].c, 0);
  return `원장 조회 ${seen[0].amount.toLocaleString()}원·${seen[0].method}·${seen[0].d}·"${seen[0].memo}", 실장 조회 ${mgr[0].c}건`;
});
await tc('TC-D41', '결제 추가', '강사·회원·다른 스튜디오 원장은 결제를 추가할 수 없고, 잘못된 금액·날짜는 거절된다', '권한 거절 3건 / 0원·미래 날짜·1년 넘은 날짜·잘못된 수단 거절', async () => {
  const pass = (await q(`select id from passes where studio_id=$1 and member_id=$2 order by created_at limit 1`, [A.id, m1]))[0];
  await rejects(rpc(P.t1, `select * from add_pass_payment($1,10000)`, [pass.id]), /원장 또는 관리자만 결제를 추가/);
  await rejects(rpc(m1, `select * from add_pass_payment($1,10000)`, [pass.id]), /원장 또는 관리자만 결제를 추가/);
  await rejects(rpc(P.ownerB, `select * from add_pass_payment($1,10000)`, [pass.id]), /수강권을 찾을 수 없습니다/);
  await rejects(rpc(P.owner, `select * from add_pass_payment($1,0)`, [pass.id]), /1원 이상/);
  await rejects(rpc(P.owner, `select * from add_pass_payment($1,10000,'card',(now() at time zone 'Asia/Seoul')::date + 1)`, [pass.id]), /오늘 이후로/);
  await rejects(rpc(P.owner, `select * from add_pass_payment($1,10000,'card',(now() at time zone 'Asia/Seoul')::date - 400)`, [pass.id]), /1년 이내/);
  await rejects(rpc(P.owner, `select * from add_pass_payment($1,10000,'bitcoin')`, [pass.id]), /결제 수단/);
});

// 12) 알림 (패치 010)
const notes = (uid, since = 0) => q(`select id, kind, title, body, data from notifications where user_id=$1 and id > $2 order by id`, [uid, since]);
const lastNoteId = async () => (await q(`select coalesce(max(id),0)::int m from notifications`))[0].m;
await tc('TC-D42', '알림', '직원이 대신 예약·대기 신청하면 회원에게 알림이 쌓이고, 회원 본인 예약은 알리지 않는다', '대신 예약 → "예약이 확정됐어요"(한국 시간 표기), 대신 대기 → "대기 1번", 본인 예약 → 0건', async () => {
  const c = await mkClass(P.t1, 30 * 24 * 60, 1 + 1, '알림 수업');
  const before = await lastNoteId();
  await book(P.owner, c.id, m1);            // 대신 예약(확정)
  await book(m2, c.id);                      // 본인 예약 → 알림 없음
  await book(P.manager, c.id, m3);           // 대신 대기
  const n1 = await notes(m1, before), n2 = await notes(m2, before), n3 = await notes(m3, before);
  assert.equal(n1.length, 1); assert.equal(n1[0].kind, 'booked_by_staff'); assert.equal(n1[0].title, '예약이 확정됐어요');
  const kst = (await q(`select public._kst_label(starts_at) l from classes where id=$1`, [c.id]))[0].l;
  assert.ok(n1[0].body.startsWith(kst + ' 알림 수업'), n1[0].body);
  assert.match(kst, /^\d{1,2}월 \d{1,2}일 \([일월화수목금토]\) \d{2}:\d{2}$/);
  assert.equal(n2.length, 0);
  assert.equal(n3.length, 1); assert.equal(n3[0].kind, 'waitlisted_by_staff'); assert.match(n3[0].body, /대기 1번/);
  assert.equal(n1[0].data.path, '/');
  return `회원1 "${n1[0].title}" — ${n1[0].body.split('\n')[0]} / 회원2(본인) 0건 / 회원3 "${n3[0].title}" 대기 1번`;
});
await tc('TC-D43', '알림', '대기 자동 확정·직원 취소는 알리고, 회원 본인 취소는 알리지 않는다', '본인 취소 0건 → 대기자 "대기에서 예약이 확정됐어요" / 직원 취소 "예약이 취소됐어요 … 복구됐어요"', async () => {
  const c = await mkClass(P.t2, 31 * 24 * 60, 1 + 1, '승격 알림');
  const a = await book(m1, c.id); await book(m2, c.id); await book(m3, c.id); // m3 대기
  const before = await lastNoteId();
  await cancel(m1, a.id);                    // 본인 취소 → m1 알림 없음, m3 승격 알림
  const b2 = (await q(`select id from bookings where class_id=$1 and member_id=$2`, [c.id, m2]))[0];
  await cancel(P.owner, b2.id);              // 직원 취소(기본 복구)
  const n1 = await notes(m1, before), n2 = await notes(m2, before), n3 = await notes(m3, before);
  assert.equal(n1.length, 0);
  assert.equal(n3.length, 1); assert.equal(n3[0].kind, 'promoted');
  assert.equal(n2.length, 1); assert.equal(n2[0].kind, 'cancelled_by_staff'); assert.match(n2[0].body, /수강권 1회가 복구됐어요/);
  return `본인 취소 0건 / 회원3 "${n3[0].title}" / 회원2 "${n2[0].title}" (${n2[0].body.split('\n')[1]})`;
});
await tc('TC-D44', '알림', '폐강하면 확정자는 "복구됐어요", 대기자는 "대기 신청도 취소" 알림을 받는다', '확정 2명 class_cancelled+복구 / 대기 1명 class_cancelled+대기 취소', async () => {
  const c = await mkClass(P.t1, 32 * 24 * 60, 2, '폐강 알림');
  await book(m1, c.id); await book(m2, c.id); await book(m3, c.id);
  const before = await lastNoteId();
  await rpc(P.owner, `select cancel_class($1)`, [c.id]);
  const all = await q(`select user_id, kind, body from notifications where id > $1 order by id`, [before]);
  assert.equal(all.length, 3); assert.ok(all.every((r) => r.kind === 'class_cancelled'));
  const byUser = Object.fromEntries(all.map((r) => [r.user_id, r.body]));
  assert.match(byUser[m1], /복구됐어요/); assert.match(byUser[m2], /복구됐어요/); assert.match(byUser[m3], /대기 신청도 함께 취소/);
});
await tc('TC-D45', '알림', '전날 알림은 내일(한국 날짜) 확정 예약에만 1번씩 쌓이고 다시 돌려도 중복되지 않는다', '내일 확정 2건만 생성(대기·폐강 제외) → 두 번째 실행 0건', async () => {
  const mk = async (title, instr) => (await q(`insert into classes(studio_id,title,instructor_id,starts_at,ends_at,max_capacity,location)
    values ($1,$2,$3, ((now() at time zone 'Asia/Seoul')::date + 1 + time '10:00') at time zone 'Asia/Seoul',
                     ((now() at time zone 'Asia/Seoul')::date + 1 + time '10:50') at time zone 'Asia/Seoul', 2, 'A룸') returning *`, [A.id, title, instr]))[0];
  const t1 = await mk('내일 수업', P.t1), t2 = await mk('내일 폐강', P.t2);
  await book(m1, t1.id); await book(m2, t1.id); await book(m3, t1.id); // m3 대기
  await book(m4, t2.id); await rpc(P.owner, `select cancel_class($1)`, [t2.id]);
  const first = (await q(`select enqueue_class_reminders() n`))[0].n;
  const second = (await q(`select enqueue_class_reminders() n`))[0].n;
  const r = await q(`select user_id, title, body from notifications where kind='reminder' order by id`);
  assert.equal(first, 2); assert.equal(second, 0);
  assert.deepEqual(r.map((x) => x.user_id).sort(), [m1, m2].sort());
  assert.equal(r[0].title, '내일 수업이 있어요'); assert.match(r[0].body, /10:00 내일 수업 · A룸/);
  return `1차 ${first}건, 2차 ${second}건, "${r[0].title}" — ${r[0].body.split('\n')[0]}`;
});
await tc('TC-D46', '알림', '알림은 본인 것만 보이고 읽음 처리되며, 푸시 토큰은 본인 기기만 등록·해제된다', '본인만 조회·읽음 / 토큰 표 직접 조회 불가 / 잘못된 토큰 거절 / 같은 기기 다른 계정 로그인 시 주인 변경', async () => {
  const mine = (await rpc(m1, `select count(*)::int c from notifications`))[0].c;
  const all1 = (await q(`select count(*)::int c from notifications where user_id=$1`, [m1]))[0].c;
  assert.equal(mine, all1);
  const others = (await rpc(P.owner, `select count(*)::int c from notifications where user_id=$1`, [m1]))[0].c;
  assert.equal(others, 0);
  const read = (await rpc(m1, `select mark_notifications_read() n`))[0].n;
  assert.equal(read, all1);
  assert.equal((await q(`select count(*)::int c from notifications where user_id=$1 and read_at is null`, [m1]))[0].c, 0);
  const tok = 'ExponentPushToken[test-device-1]';
  await rpc(m1, `select register_push_token($1,'ios')`, [tok]);
  await rejects(rpc(m1, `select count(*) from push_tokens`), /permission denied/);
  await rejects(rpc(m1, `select register_push_token('abc','ios')`), /형식이 올바르지 않습니다/);
  await rpc(m2, `select register_push_token($1,'ios')`, [tok]); // 같은 기기, 다른 계정
  assert.equal((await q(`select user_id from push_tokens where token=$1`, [tok]))[0].user_id, m2);
  await rpc(m1, `select unregister_push_token($1)`, [tok]);   // 남의 토큰은 못 지움
  assert.equal((await q(`select count(*)::int c from push_tokens where token=$1`, [tok]))[0].c, 1);
  await rpc(m2, `select unregister_push_token($1)`, [tok]);
  assert.equal((await q(`select count(*)::int c from push_tokens where token=$1`, [tok]))[0].c, 0);
  return `본인 알림 ${mine}건 조회·${read}건 읽음, 원장이 남의 알림 조회 0건, 토큰 주인 변경·해제 확인`;
});

// 13) 푸시 자동 호출 (패치 011)
await tc('TC-D47', '알림', '알림이 쌓이면 send-push 함수를 호출하고, 주소 설정 전에는 호출하지 않는다 (여러 번 불려도 발송은 1번 — TC-P01)', '주소 없음 → 호출 0 / 주소 설정 후 폐강(3명 알림) → 알림마다 호출(3번), 비밀값 헤더 포함, 회원은 설정 조회 불가', async () => {
  await q(`delete from net._calls`); await q(`delete from app_settings`);
  const c1 = await mkClass(P.t1, 40 * 24 * 60, 4, '호출 전');
  await book(P.owner, c1.id, m1);
  const before = (await q(`select count(*)::int c from net._calls`))[0].c;
  await q(`insert into app_settings values ('send_push_url','https://ref.supabase.co/functions/v1/send-push'), ('send_push_secret','s3cret')`);
  const c2 = await mkClass(P.t2, 41 * 24 * 60, 4, '호출 후');
  await book(m1, c2.id); await book(m2, c2.id); await book(m3, c2.id);
  await q(`delete from net._calls`);
  await rpc(P.owner, `select cancel_class($1)`, [c2.id]);
  const calls = await q(`select url, headers from net._calls`);
  const notes3 = (await q(`select count(*)::int c from notifications where kind='class_cancelled' and body like '%호출 후%'`))[0].c;
  assert.equal(before, 0); assert.equal(notes3, 3);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'https://ref.supabase.co/functions/v1/send-push'); assert.equal(calls[0].headers['x-push-secret'], 's3cret');
  await rejects(rpc(m1, `select * from app_settings`), /permission denied/);
  return `설정 전 호출 ${before}번 / 폐강 알림 ${notes3}건 → 호출 ${calls.length}번, 헤더 x-push-secret 포함, 회원은 설정 조회 불가`;
});

// 14) 회원 탈퇴 (패치 012)
const newUser = async (n, name) => {
  await q(`insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,$3)`, [U(n), `w${n}@t.dev`, JSON.stringify({ name, phone: '010-1234-5678' })]);
  return U(n);
};
await tc('TC-D48', '회원 탈퇴', '탈퇴하면 개인정보는 지워지고 예약·출석·결제 기록은 "탈퇴 회원"으로 남는다', '이름 "탈퇴 회원"·연락처·이메일·메모·푸시 토큰·알림 삭제 / 지난 출석·결제 그대로 / 앞으로의 예약 취소 → 대기자 자동 확정 / 다시 불러도 안전', async () => {
  const w = await newUser(21, '탈퇴예정');
  await rpc(w, `select * from join_studio($1)`, [A.invite_code]);
  const pass = await issue(w, 'group', 10);
  await rpc(P.owner, `select * from add_pass_payment($1,99000,'card')`, [pass.id]);
  await rpc(P.owner, `update studio_members set memo='허리 부상' where studio_id=$1 and user_id=$2`, [A.id, w]);
  const past = await mkClass(P.t1, -3 * 24 * 60, 4, '지난 수업');
  await q(`insert into bookings(studio_id,class_id,member_id,pass_id,status) values ($1,$2,$3,$4,'attended')`, [A.id, past.id, w, pass.id]);
  const fut = await mkClass(P.t1, 50 * 24 * 60, 2, '탈퇴 전 예약');
  const mine = await book(w, fut.id);
  await book(m3, fut.id);
  const wait = await book(m4, fut.id);
  await rpc(P.owner, `select * from book_class($1,$2)`, [(await mkClass(P.t2, 51 * 24 * 60, 4, '알림용')).id, w]); // 알림 1건 생성
  await rpc(w, `select register_push_token('ExponentPushToken[withdraw-1]','ios')`);
  const notesBefore = (await q(`select count(*)::int c from notifications where user_id=$1`, [w]))[0].c;

  const r = (await rpc(w, `select withdraw_account() r`))[0].r;
  const u = (await q(`select name, phone, email, withdrawn_at from users where id=$1`, [w]))[0];
  const sm = (await q(`select status, memo from studio_members where user_id=$1`, [w]))[0];
  const kept = (await q(`select (select count(*)::int from bookings where member_id=$1 and status='attended') att,
                                (select count(*)::int from pass_payments where member_id=$1) pay,
                                (select count(*)::int from push_tokens where user_id=$1) tok,
                                (select count(*)::int from notifications where user_id=$1) noti`, [w]))[0];
  assert.equal(u.name, '탈퇴 회원'); assert.equal(u.phone, null); assert.equal(u.email, null); assert.ok(u.withdrawn_at);
  assert.deepEqual(sm, { status: 'left', memo: null });
  assert.equal(kept.att, 1); assert.equal(kept.pay, 1); assert.equal(kept.tok, 0); assert.equal(kept.noti, 0);
  assert.equal(await status(mine.id), 'cancelled'); assert.equal(await status(wait.id), 'confirmed');
  assert.equal(r.cancelled_bookings, 2);
  const seenByOwner = (await rpc(P.owner, `select name from users where id=$1`, [w]))[0];
  const again = (await rpc(w, `select withdraw_account() r`))[0].r;
  assert.equal(again.already, true);
  return `취소 ${r.cancelled_bookings}건(대기자 자동 확정), 원장 화면 이름 "${seenByOwner?.name}", 출석 ${kept.att}·결제 ${kept.pay}건 보존, 토큰 ${kept.tok}·알림 ${notesBefore}→${kept.noti}건, 두 번째 호출 already=${again.already}`;
});
await tc('TC-D49', '회원 탈퇴', '유일한 원장(다른 사람이 남은 스튜디오)·진행 예정 수업 담당 강사는 탈퇴할 수 없고, 비로그인은 호출할 수 없다', '원장 거절(스튜디오 이름 안내) / 강사 거절(수업 수 안내) / 거절 시 아무것도 바뀌지 않음 / anon 거절', async () => {
  await mkClass(P.t1, 52 * 24 * 60, 4, '담당 수업');
  await rejects(rpc(P.owner, `select withdraw_account()`), /다른 원장이 없는 스튜디오가 있어 탈퇴할 수 없어요 \(테스트 필라테스\)/);
  await rejects(rpc(P.t1, `select withdraw_account()`), /담당 중인 진행 예정 수업이 \d+개/);
  const still = (await q(`select name, withdrawn_at from users where id in ($1,$2) order by name`, [P.owner, P.t1]));
  assert.ok(still.every((x) => x.withdrawn_at === null && x.name !== '탈퇴 회원'));
  await db.exec(`set role anon`);
  try { await rejects(q(`select withdraw_account()`), /permission denied/); } finally { await db.exec(`reset role`); }
  const n = (await q(`select count(*)::int c from classes where instructor_id=$1 and status='scheduled' and ends_at>now()`, [P.t1]))[0].c;
  return `원장·강사(${n}개 수업) 거절, 두 계정 정보 그대로, anon 권한 거절`;
});
await tc('TC-D50', '회원 탈퇴', '혼자인 스튜디오의 원장은 탈퇴할 수 있고, 탈퇴한 계정은 초대 코드로 다시 참여할 수 없다', '탈퇴 성공 / join_studio → "탈퇴한 계정입니다"', async () => {
  const solo = await newUser(22, '1인원장');
  const C = (await rpc(solo, `select * from create_studio('혼자 스튜디오')`))[0];
  await rpc(solo, `select withdraw_account()`);
  await rejects(rpc(solo, `select * from join_studio($1)`, [A.invite_code]), /탈퇴한 계정입니다/);
  const left = (await q(`select status from studio_members where studio_id=$1 and user_id=$2`, [C.id, solo]))[0].status;
  return `탈퇴 성공(소속 ${left}), 재참여 거절`;
});

// 15) 수업 수정 (패치 013 + classes_staff_update 정책)
await tc('TC-D51', '수업 수정', '강사는 자기 수업만 고칠 수 있고, 남의 수업이나 담당 강사를 다른 사람으로 바꾸는 수정은 막힌다. 원장은 모든 수업을 고칠 수 있다', '강사: 내 수업 제목 수정 1건 / 남의 수업 0건 / 담당을 남에게 넘기기 거절 · 원장: 남의 수업 수정 1건', async () => {
  const mine = await mkClass(P.t1, 53 * 24 * 60, 4, '강사1 수업');
  const others = await mkClass(P.t2, 53 * 24 * 60 + 120, 4, '강사2 수업');
  const r1 = (await rpc(P.t1, `update classes set title='강사1 수정' where id=$1 returning id`, [mine.id])).length;
  const r2 = (await rpc(P.t1, `update classes set title='남의 수업 수정' where id=$1 returning id`, [others.id])).length;
  await rejects(rpc(P.t1, `update classes set instructor_id=$2 where id=$1`, [mine.id, P.t2]), /row-level security|policy/);
  const r3 = (await rpc(P.owner, `update classes set title='원장 수정', location='B룸' where id=$1 returning id`, [others.id])).length;
  const titles = await q(`select title from classes where id in ($1,$2) order by title`, [mine.id, others.id]);
  assert.equal(r1, 1); assert.equal(r2, 0); assert.equal(r3, 1);
  return `강사 본인 수업 ${r1}건·남의 수업 ${r2}건 수정, 담당 넘기기 거절, 원장 ${r3}건 수정 → ${titles.map((t) => t.title).join(', ')}`;
});
await tc('TC-D52', '수업 수정', '정원은 현재 예약 인원보다 줄일 수 없고, 예약이 있는 수업은 1:1↔그룹 유형을 바꿀 수 없다', '정원 3→1명(확정 2명) 거절 / 3→2 허용 / 그룹→1:1 거절 / 예약 없는 수업 4→1 허용', async () => {
  const c = await mkClass(P.t1, 54 * 24 * 60, 3, '정원 테스트');
  await book(m3, c.id); await book(m4, c.id);
  await rejects(rpc(P.owner, `update classes set max_capacity=1 where id=$1`, [c.id]), /예약 인원\(2명\)보다 정원을 줄일 수 없습니다|1:1 ↔ 그룹/);
  await rpc(P.owner, `update classes set max_capacity=2 where id=$1`, [c.id]);
  const empty = await mkClass(P.t1, 54 * 24 * 60 + 120, 4, '빈 수업');
  await rpc(P.owner, `update classes set max_capacity=1 where id=$1`, [empty.id]);
  const caps = await q(`select max_capacity from classes where id in ($1,$2) order by title desc`, [c.id, empty.id]);
  const c2 = await mkClass(P.t1, 54 * 24 * 60 + 240, 4, '유형 테스트');
  await book(m3, c2.id);
  await rejects(rpc(P.owner, `update classes set max_capacity=1 where id=$1`, [c2.id]), /1:1 ↔ 그룹/);
  return `확정 2명 수업 정원 1 거절·2 허용, 예약 있는 그룹→1:1 거절, 빈 수업 1:1 전환 허용 (정원 ${caps.map((x) => x.max_capacity).join('/')})`;
});

// 8) 스튜디오 격리
await tc('TC-D28', '스튜디오 격리', '다른 스튜디오 원장은 이 스튜디오의 예약·수강권·회원을 볼 수 없다', '조회 결과 0건', async () => {
  const r = await asRole(P.ownerB, async () => ({
    bookings: (await q(`select count(*)::int c from bookings where studio_id=$1`, [A.id]))[0].c,
    passes: (await q(`select count(*)::int c from passes where studio_id=$1`, [A.id]))[0].c,
    logs: (await q(`select count(*)::int c from pass_logs where studio_id=$1`, [A.id]))[0].c,
    members: (await q(`select count(*)::int c from studio_members where studio_id=$1`, [A.id]))[0].c,
  }));
  assert.deepEqual(r, { bookings: 0, passes: 0, logs: 0, members: 0 });
  return `예약 ${r.bookings} · 수강권 ${r.passes} · 기록 ${r.logs} · 회원 ${r.members}건`;
});

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
fs.writeFileSync(outPath, JSON.stringify({ schema: schemaPath, ranAt: new Date().toISOString(), results }, null, 2));
process.exit(passed === results.length ? 0 : 1);
