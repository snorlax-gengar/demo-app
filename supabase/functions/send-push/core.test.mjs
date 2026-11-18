// node --experimental-strip-types core.test.mjs  (Node 22+)
import assert from 'node:assert/strict';
import { sendPending } from './core.ts';

const results = [];
const tc = async (id, title, expected, fn) => {
  try { const actual = await fn(); results.push({ id, area: '푸시 발송', title, expected, actual: actual ?? '기대와 같음', pass: true, ms: 0 }); console.log('PASS', id, actual ?? ''); }
  catch (e) { results.push({ id, area: '푸시 발송', title, expected, actual: String(e.message), pass: false, ms: 0 }); console.log('FAIL', id, e.message); }
};

function fakeStore(notes, tokens) {
  const log = { errors: [], deleted: [] };
  let claimed = false;
  return {
    log,
    store: {
      async claimUnsent() { if (claimed) return []; claimed = true; return notes; },
      async tokensFor(ids) { return tokens.filter((t) => ids.includes(t.user_id)); },
      async markError(ids, err) { log.errors.push({ ids, err }); },
      async deleteTokens(t) { log.deleted.push(...t); },
    },
  };
}
const note = (id, user) => ({ id, user_id: user, title: `제목${id}`, body: `본문${id}`, data: { path: '/' } });

await tc('TC-P01', '보낼 알림을 기기마다 Expo 형식으로 보내고, 같은 알림은 두 번 보내지 않는다', '메시지 3건(회원A 기기 2대·회원B 1대), 두 번째 실행 0건', async () => {
  const { store } = fakeStore([note(1, 'A'), note(2, 'B')], [{ token: 'ExponentPushToken[a1]', user_id: 'A' }, { token: 'ExponentPushToken[a2]', user_id: 'A' }, { token: 'ExponentPushToken[b1]', user_id: 'B' }]);
  const sent = [];
  const fetchFn = async (url, init) => { sent.push({ url, init }); const body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ data: body.map(() => ({ status: 'ok', id: 'x' })) }) }; };
  const r1 = await sendPending(store, fetchFn);
  const r2 = await sendPending(store, fetchFn);
  assert.equal(sent.length, 1);
  const msgs = JSON.parse(sent[0].init.body);
  assert.equal(sent[0].url, 'https://exp.host/--/api/v2/push/send');
  assert.equal(msgs.length, 3);
  assert.deepEqual(msgs[0], { to: 'ExponentPushToken[a1]', title: '제목1', body: '본문1', data: { path: '/' }, sound: 'default', channelId: 'default', priority: 'high' });
  assert.deepEqual(r1, { claimed: 2, messages: 3, ok: 3, noToken: 0, failed: 0, removedTokens: 0 });
  assert.equal(r2.claimed, 0);
  return `1차: 알림 ${r1.claimed}건 → 메시지 ${r1.messages}건 성공 ${r1.ok} / 2차: ${r2.claimed}건`;
});
await tc('TC-P02', '토큰이 없는 회원의 알림은 "no_token" 으로 기록하고 보내지 않는다', 'Expo 호출 0번, no_token 1건', async () => {
  const { store, log } = fakeStore([note(5, 'C')], []);
  let calls = 0;
  const r = await sendPending(store, async () => { calls++; return { ok: true, status: 200, json: async () => ({ data: [] }) }; });
  assert.equal(calls, 0); assert.equal(r.noToken, 1); assert.deepEqual(log.errors, [{ ids: [5], err: 'no_token' }]);
});
await tc('TC-P03', '앱을 지운 기기(DeviceNotRegistered)는 토큰을 지우고, 다른 기기로 성공했으면 실패로 기록하지 않는다', '죽은 토큰 1개 삭제, 알림 1은 실패 기록 없음, 알림 2는 실패 기록', async () => {
  const { store, log } = fakeStore([note(1, 'A'), note(2, 'B')], [{ token: 'ExponentPushToken[dead]', user_id: 'A' }, { token: 'ExponentPushToken[live]', user_id: 'A' }, { token: 'ExponentPushToken[bdead]', user_id: 'B' }]);
  const fetchFn = async (_u, init) => ({ ok: true, status: 200, json: async () => ({ data: JSON.parse(init.body).map((m) => (m.to.includes('dead') ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' })) }) });
  const r = await sendPending(store, fetchFn);
  assert.deepEqual(log.deleted.sort(), ['ExponentPushToken[bdead]', 'ExponentPushToken[dead]']);
  assert.deepEqual(log.errors, [{ ids: [2], err: 'DeviceNotRegistered' }]);
  assert.equal(r.ok, 1); assert.equal(r.failed, 2); assert.equal(r.removedTokens, 2);
  return `성공 ${r.ok}·실패 ${r.failed}, 토큰 ${r.removedTokens}개 삭제, 실패 기록은 알림 2만`;
});
await tc('TC-P04', 'Expo 서버 오류 시 해당 알림에 실패 사유를 남기고, 100건 단위로 나눠 보낸다', '메시지 150건 → 요청 2번(100+50), 두 번째 요청 실패 시 50건 send_failed 기록', async () => {
  const notes = Array.from({ length: 150 }, (_, i) => note(i + 1, 'U' + i));
  const tokens = notes.map((n) => ({ token: `ExponentPushToken[${n.user_id}]`, user_id: n.user_id }));
  const { store, log } = fakeStore(notes, tokens);
  const sizes = [];
  const fetchFn = async (_u, init) => { const b = JSON.parse(init.body); sizes.push(b.length); if (sizes.length === 2) return { ok: false, status: 503, json: async () => ({ errors: [{ message: 'Service Unavailable' }] }) }; return { ok: true, status: 200, json: async () => ({ data: b.map(() => ({ status: 'ok' })) }) }; };
  const r = await sendPending(store, fetchFn, { accessToken: 'tok' });
  assert.deepEqual(sizes, [100, 50]);
  assert.equal(r.ok, 100); assert.equal(r.failed, 50);
  assert.equal(log.errors.length, 1); assert.equal(log.errors[0].ids.length, 50); assert.match(log.errors[0].err, /send_failed: Service Unavailable/);
  return `요청 ${sizes.join('+')}건, 성공 ${r.ok}·실패 ${r.failed} (${log.errors[0].err})`;
});

const fs = await import('node:fs');
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({ results }, null, 2));
console.log(`${results.filter((r) => r.pass).length}/${results.length} passed`);
process.exit(results.every((r) => r.pass) ? 0 : 1);
