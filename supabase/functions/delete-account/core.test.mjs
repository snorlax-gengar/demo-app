// node --experimental-strip-types core.test.mjs [out.json]  (Node 22+)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deleteAccount } from './core.ts';

const results = [];
const tc = async (id, title, expected, fn) => {
  try { const actual = await fn(); results.push({ id, area: '회원 탈퇴', title, expected, actual: actual ?? '기대와 같음', pass: true, ms: 0 }); console.log('PASS', id, actual ?? ''); }
  catch (e) { results.push({ id, area: '회원 탈퇴', title, expected, actual: String(e.message), pass: false, ms: 0 }); console.log('FAIL', id, e.message); }
};
const deps = (over = {}) => {
  const log = { withdraw: 0, softDeleted: [] };
  return {
    log,
    deps: {
      userId: async () => 'U1',
      withdraw: async () => { log.withdraw += 1; return { already: false, cancelled_bookings: 2 }; },
      softDelete: async (id) => { log.softDeleted.push(id); },
      ...over,
    },
  };
};

await tc('TC-W01', '로그인한 사람의 탈퇴: 기록 익명화 후 로그인 계정을 소프트 삭제한다', '200, 익명화 1번 → 본인 id 소프트 삭제', async () => {
  const { deps: d, log } = deps();
  const r = await deleteAccount(d);
  assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, cancelledBookings: 2 });
  assert.equal(log.withdraw, 1); assert.deepEqual(log.softDeleted, ['U1']);
  return `200 ${JSON.stringify(r.body)}, 소프트 삭제 ${log.softDeleted.join(',')}`;
});
await tc('TC-W02', '로그인 토큰이 없거나 만료되면 아무것도 하지 않는다', '401, 익명화·삭제 0번', async () => {
  const { deps: d, log } = deps({ userId: async () => null });
  const r = await deleteAccount(d);
  assert.equal(r.status, 401); assert.equal(log.withdraw, 0); assert.equal(log.softDeleted.length, 0);
  return `${r.status} "${r.body.error}"`;
});
await tc('TC-W03', 'DB 가 탈퇴를 막으면(유일한 원장 등) 그 안내를 그대로 돌려주고 계정은 지우지 않는다', '400 + DB 안내 문구, 삭제 0번', async () => {
  const msg = '다른 원장이 없는 스튜디오가 있어 탈퇴할 수 없어요 (테스트 필라테스). 다른 사람을 원장으로 지정한 뒤 다시 시도해 주세요.';
  const { deps: d, log } = deps({ withdraw: async () => { throw new Error(msg); } });
  const r = await deleteAccount(d);
  assert.equal(r.status, 400); assert.equal(r.body.error, msg); assert.equal(log.softDeleted.length, 0);
  return `${r.status} "${r.body.error.slice(0, 30)}…"`;
});
await tc('TC-W04', '로그인 계정 삭제가 실패하면 다시 시도할 수 있다고 알리고, 재시도하면 마무리된다', '1차 500 retryable / 2차 200 (익명화는 already)', async () => {
  let fail = true;
  const { deps: d, log } = deps({ softDelete: async (id) => { if (fail) { fail = false; throw new Error('network'); } log.softDeleted.push(id); } });
  const r1 = await deleteAccount(d);
  d.withdraw = async () => ({ already: true, cancelled_bookings: 0 });
  const r2 = await deleteAccount(d);
  assert.equal(r1.status, 500); assert.equal(r1.body.retryable, true);
  assert.equal(r2.status, 200); assert.deepEqual(log.softDeleted, ['U1']);
  return `1차 ${r1.status}(retryable) → 2차 ${r2.status}`;
});

if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({ results }, null, 2));
console.log(`${results.filter((r) => r.pass).length}/${results.length} passed`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
