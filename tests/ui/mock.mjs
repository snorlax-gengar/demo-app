// Fake Supabase (auth + PostgREST subset) for the multi-studio app — smoke test only
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIST = process.argv[2];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Date.now();
const H = 3600e3;
const at = (day, hour, min = 0) => { const d = new Date(); d.setHours(hour, min, 0, 0); return new Date(d.getTime() + day * 24 * H).toISOString(); };
const dateOnly = (off) => new Date(now + off * 24 * H).toISOString().slice(0, 10);

const users = {
  'member@x.com': { id: 'm1', name: '김하늘', phone: '010-1234-5678' },
  'teacher@x.com': { id: 't1', name: '박서연', phone: '010-2222-3333' },
  'owner@x.com': { id: 'a1', name: '이도윤', phone: '010-9999-0000' },
  'manager@x.com': { id: 'mg1', name: '한실장', phone: '010-7777-1111' },
  'new1@x.com': { id: 'n1', name: '신규원장', phone: null },
  'new2@x.com': { id: 'n2', name: '신규회원', phone: null },
  // 카카오로 처음 들어온 사람: 약관 동의 기록 없음, 이름은 카카오 닉네임
  'kakao@x.com': { id: 'k1', name: '카카오닉네임', phone: null },
};
// 계정 정보(user_metadata): 이메일 가입자는 약관 동의 기록이 있다고 가정
const userMeta = {};
const metaOf = (id) => (userMeta[id] ??= id === 'k1' ? { name: '카카오닉네임' } : { terms_agreed_at: '2026-11-18T00:00:00Z', terms_version: 'test' });
const appMetaOf = (id) => ({ provider: id === 'k1' ? 'kakao' : 'email' });
const extraPeople = ['최지우', '정민서', '한유진', '오세훈'].map((n, i) => ({ id: 'mm' + i, name: n, phone: `010-55${i}5-12${i}4`, email: `m${i}@x.com` }));
const profileOf = (id) => {
  const e = Object.entries(users).find(([, u]) => u.id === id);
  if (e) return { ...e[1], email: e[0], created_at: '2026-03-02T01:00:00Z' };
  const x = extraPeople.find((p) => p.id === id);
  return x ? { ...x, created_at: '2026-05-01T00:00:00Z' } : null;
};

const studios = {
  S1: { id: 'S1', name: '데모 필라테스', invite_code: 'DEMO22', created_by: 'a1', created_at: '2026-01-01T00:00:00Z' },
  S2: { id: 'S2', name: '이선생 수학교실', invite_code: 'MATH77', created_by: 'zz', created_at: '2026-02-01T00:00:00Z' },
};
// studio_members rows
const members = [
  { studio_id: 'S1', user_id: 'a1', role: 'owner', memo: null },
  { studio_id: 'S1', user_id: 't1', role: 'instructor', memo: null },
  { studio_id: 'S1', user_id: 'mg1', role: 'manager', memo: null },
  { studio_id: 'S1', user_id: 'm1', role: 'member', memo: '허리 디스크 이력 — 롤다운 주의' },
  ...extraPeople.map((p) => ({ studio_id: 'S1', user_id: p.id, role: 'member', memo: null })),
  { studio_id: 'S2', user_id: 'a1', role: 'member', memo: null },
].map((m) => ({ status: 'active', joined_at: '2026-03-02T01:00:00Z', ...m }));

const pass = (id, member_id, class_type, remaining_count, expOff, total_count = 10, studio_id = 'S1') =>
  ({ id, studio_id, member_id, class_type, name: class_type === 'private' ? '1:1 개인 10회권' : '4:1 그룹 20회권', total_count, remaining_count, starts_on: dateOnly(-30), expires_on: dateOnly(expOff), is_active: true, created_at: '2026-10-01T00:00:00Z' });
const passes = [
  pass('p1', 'm1', 'private', 7, 5), pass('p2', 'm1', 'group', 13, 62, 20),
  pass('p4', 'mm0', 'group', 12, 60, 20), pass('p5', 'mm1', 'group', 1, 40), pass('p6', 'mm2', 'group', 6, 4),
  pass('p9', 'a1', 'private', 5, 30, 10, 'S2'),
];

const ov = (id, studio_id, title, day, hour, cap, conf, wait, instr = ['t1', '박서연'], mine = null) => ({
  id, studio_id, title, instructor_id: instr[0], instructor_name: instr[1], starts_at: at(day, hour), ends_at: at(day, hour, 50),
  max_capacity: cap, class_type: cap === 1 ? 'private' : 'group', status: 'scheduled', location: cap === 1 ? 'A룸' : 'B룸',
  confirmed_count: conf, waitlist_count: wait, my_booking_id: mine ? 'b-' + id : null, my_booking_status: mine, my_waitlist_position: mine === 'waitlist' ? 2 : null,
});
const overview = [
  ov('c1', 'S1', '1:1 개인 레슨', 0, 23, 1, 0, 0),
  ov('c2', 'S1', '4:1 그룹 리포머', 0, 23, 4, 3, 0, ['a1', '이도윤']),
  ov('c5', 'S1', '4:1 그룹 리포머', 1, 19, 4, 4, 2, ['t1', '박서연'], 'waitlist'),
  ov('c6', 'S1', '1:1 개인 레슨', 2, 10, 1, 1, 0, ['t1', '박서연'], 'confirmed'),
  ov('x1', 'S2', '수학 1:1 과외', 1, 18, 1, 1, 0, ['zz', '이선생'], 'confirmed'),
  ov('x2', 'S2', '수학 1:1 과외', 3, 18, 1, 0, 0, ['zz', '이선생']),
];
const mPasses = (id) => passes.filter((p) => p.member_id === id && p.studio_id === 'S1');
const bk = (id, status, mid) => ({ id, status, created_at: `2026-11-1${id.length}T0${id.charCodeAt(1) % 9}:00:00Z`, member: { ...profileOf(mid), passes: mPasses(mid) } });
const timeline = [
  { id: 'c9', studio_id: 'S1', status: 'scheduled', title: '4:1 그룹 리포머', starts_at: new Date(now - 0.3 * H).toISOString(), ends_at: new Date(now + 0.5 * H).toISOString(), max_capacity: 4, class_type: 'group', location: 'B룸', instructor_id: 't1', instructor: { id: 't1', name: '박서연' }, bookings: [bk('b2', 'attended', 'mm0'), bk('b3', 'no_show', 'mm1'), bk('b4', 'confirmed', 'm1'), bk('b5', 'confirmed', 'mm2')] },
];
timeline.push({ id: 'c11', studio_id: 'S1', status: 'scheduled', title: '[테스트] 저녁 그룹', starts_at: new Date(now + 3 * H).toISOString(), ends_at: new Date(now + 3 * H + 50 * 60e3).toISOString(), max_capacity: 4, class_type: 'group', location: 'B룸', instructor_id: 'a1', instructor: { id: 'a1', name: '이도윤' }, bookings: [bk('b20', 'confirmed', 'm1')] });
// 회원 오세훈(mm3)은 수강권 없음, 정민서(mm1)는 그룹 1회 남음
const passLogs = {
  p2: [
    { id: 5, delta: -1, remaining_after: 13, reason: 'waitlist_promotion', memo: '빈자리가 생겨 대기 순번대로 자동 확정', created_at: new Date(now - 1 * H).toISOString(), actor: null },
    { id: 4, delta: 1, remaining_after: 14, reason: 'cancel_refund', memo: null, created_at: new Date(now - 26 * H).toISOString(), actor: { name: '김하늘' } },
    { id: 3, delta: -1, remaining_after: 13, reason: 'booking', memo: null, created_at: new Date(now - 50 * H).toISOString(), actor: { name: '이도윤' } },
    { id: 2, delta: -6, remaining_after: 14, reason: 'booking', memo: '지난 6회 사용', created_at: new Date(now - 300 * H).toISOString(), actor: { name: '김하늘' } },
    { id: 1, delta: 20, remaining_after: 20, reason: 'issued', memo: null, created_at: new Date(now - 700 * H).toISOString(), actor: { name: '이도윤' } },
  ],
};
const rpcLog = [];
// 알림함: 회원 김하늘(m1)에게 2건(안 읽음), 1건(읽음)
const notifications = [
  { id: 3, user_id: 'm1', kind: 'promoted', title: '대기에서 예약이 확정됐어요', body: '11월 20일 (금) 19:00 4:1 그룹 리포머\n자리가 나서 자동으로 확정됐어요. 수강권 1회가 차감됐어요.', data: { path: '/' }, created_at: new Date(now - 0.2 * H).toISOString(), read_at: null, studio_id: 'S1' },
  { id: 2, user_id: 'm1', kind: 'reminder', title: '내일 수업이 있어요', body: '11월 19일 (목) 10:00 1:1 개인 레슨 · A룸\n데모 필라테스 · 못 오시면 24시간 전까지 앱에서 취소해 주세요.', data: { path: '/' }, created_at: new Date(now - 14 * H).toISOString(), read_at: null, studio_id: 'S1' },
  { id: 1, user_id: 'm1', kind: 'cancelled_by_staff', title: '예약이 취소됐어요', body: '11월 15일 (일) 11:00 4:1 그룹 리포머\n데모 필라테스에서 취소했어요. 수강권 1회가 복구됐어요.', data: { path: '/' }, created_at: new Date(now - 72 * H).toISOString(), read_at: new Date(now - 70 * H).toISOString(), studio_id: 'S1' },
];
const products = [];
// 매출용 결제 기록: 이번 달 5건(합계 1,520,000) / 지난달 2건(합계 1,200,000) → 26.7% 증가
const ym = (off) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + off); return d.toISOString().slice(0, 7); };
const pay = (id, pass_id, member_id, amount, method, ymOff, day, memo = null) => ({ id, pass_id, member_id, amount, method, paid_on: `${ym(ymOff)}-${String(day).padStart(2, '0')}`, memo });
const payments = [
  pay('pay1', 'p2', 'm1', 400000, 'card', 0, 2),
  pay('pay2', 'p4', 'mm0', 380000, 'transfer', 0, 5, '재등록 할인'),
  pay('pay3', 'p1', 'm1', 450000, 'card', 0, 9),
  pay('pay4', 'p5', 'mm1', 120000, 'cash', 0, 9),
  pay('pay5', 'p6', 'mm2', 170000, 'card', 0, 12),
  pay('pay6', 'p2', 'm1', 600000, 'card', -1, 14),
  pay('pay7', 'p4', 'mm0', 600000, 'transfer', -1, 20),
];
const passMeta = (id) => { const x = passes.find((p) => p.id === id); return x ? { id: x.id, name: x.name, class_type: x.class_type } : null; };
const createdStudios = [];
let codeSeq = 0;

const tokenFor = (email) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: users[email].id, email, role: 'authenticated', exp: Math.floor(now / 1000) + 3600 })}.sig`;
const meOf = (req) => { try { return JSON.parse(Buffer.from((req.headers.authorization || '').split('.')[1], 'base64url')).sub; } catch { return null; } };
const eq = (v) => (v || '').replace(/^eq\./, '');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }); res.end(body === null ? '' : JSON.stringify(body)); };
  if (req.method === 'OPTIONS') return send(200, {});
  let body = ''; for await (const c of req) body += c;
  const p = url.pathname;

  if (p === '/auth/v1/token') {
    const { email } = JSON.parse(body || '{}');
    if (email === 'unconfirmed@x.com') return send(400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
    if (!users[email]) return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 400 });
    return send(200, { access_token: tokenFor(email), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(now / 1000) + 3600, refresh_token: 'r', user: { id: users[email].id, email, aud: 'authenticated', role: 'authenticated', app_metadata: appMetaOf(users[email].id), user_metadata: metaOf(users[email].id) } });
  }
  // 비밀번호 찾기 메일 요청 / 재설정 링크로 비밀번호 변경
  if (p === '/auth/v1/recover') { rpcLog.push({ fn: 'recover', args: { ...JSON.parse(body || '{}'), redirect_to: url.searchParams.get('redirect_to') } }); return send(200, {}); }
  if (p === '/auth/v1/user' && req.method === 'PUT') {
    const id = meOf(req); const pr = profileOf(id); const j = JSON.parse(body || '{}');
    if (j.data) Object.assign(metaOf(id), j.data);
    rpcLog.push({ fn: 'update_user', args: { me: id, password: j.password ? '(입력됨)' : null, data: j.data ?? null } });
    return send(200, { id, email: pr?.email, aud: 'authenticated', role: 'authenticated', app_metadata: appMetaOf(id), user_metadata: metaOf(id) });
  }
  if (p === '/auth/v1/user') { const id = meOf(req); const pr = profileOf(id); return send(200, { id, email: pr.email, aud: 'authenticated', role: 'authenticated', app_metadata: appMetaOf(id), user_metadata: metaOf(id) }); }
  // 소셜 로그인(가짜): Supabase 인증 주소 → 바로 앱 주소로 토큰과 함께 돌려보낸다 (카카오·구글 로그인 성공 상황)
  if (p === '/auth/v1/authorize') {
    const provider = url.searchParams.get('provider'); const back = url.searchParams.get('redirect_to');
    rpcLog.push({ fn: 'authorize', args: { provider, redirect_to: back, scopes: url.searchParams.get('scopes') } });
    res.writeHead(302, { location: `${back}#access_token=${tokenFor('kakao@x.com')}&expires_in=3600&refresh_token=rk&token_type=bearer&provider_token=x` });
    return res.end();
  }
  if (p === '/auth/v1/logout') return send(204, null);

  // 가입: 동의 기록(user_metadata)만 남기고 '이메일 인증' 흐름(세션 없음)으로 응답
  if (p === '/auth/v1/signup') {
    const j = JSON.parse(body || '{}');
    rpcLog.push({ fn: 'signup', args: { email: j.email, data: j.data, redirect_to: url.searchParams.get('redirect_to') } });
    return send(200, { id: 'su1', email: j.email, aud: 'authenticated', role: 'authenticated', user_metadata: j.data, identities: [{ id: 'i' }], confirmation_sent_at: new Date().toISOString() });
  }
  // 회원 탈퇴 Edge Function: 원장 이도윤(a1)은 유일한 원장이라 거절, 나머지는 성공
  if (p === '/functions/v1/delete-account') {
    const me = meOf(req);
    rpcLog.push({ fn: 'delete-account', args: { me } });
    if (!me) return send(401, { error: '로그인이 필요합니다. 다시 로그인한 뒤 시도해 주세요.' });
    if (me === 'a1') return send(400, { error: '다른 원장이 없는 스튜디오가 있어 탈퇴할 수 없어요 (데모 필라테스). 다른 사람을 원장으로 지정한 뒤 다시 시도해 주세요.' });
    return send(200, { ok: true, cancelledBookings: 2 });
  }
  if (p === '/__rpc_log') return send(200, rpcLog);
  if (p.startsWith('/rest/v1/')) {
    const me = meOf(req);
    const table = p.slice('/rest/v1/'.length);
    const single = (req.headers.accept || '').includes('vnd.pgrst.object');
    const q = Object.fromEntries(url.searchParams);
    console.log('REST', req.method, table, JSON.stringify(q), body.slice(0, 120));
    const out = (rows) => send(200, single ? rows[0] ?? null : rows);
    const args = body ? JSON.parse(body) : {};

    if (table === 'rpc/create_studio') {
      const id = 'NS' + createdStudios.length;
      const s = { id, name: args.p_name, invite_code: 'NEW' + String(++codeSeq).padStart(3, '0'), created_by: me, created_at: new Date().toISOString() };
      studios[id] = s; createdStudios.push(s);
      members.push({ studio_id: id, user_id: me, role: 'owner', memo: null, status: 'active', joined_at: new Date().toISOString() });
      return send(200, s);
    }
    if (table === 'rpc/join_studio') {
      const s = Object.values(studios).find((x) => x.invite_code === String(args.p_code).toUpperCase());
      if (!s) return send(400, { code: 'P0001', message: '초대 코드를 찾을 수 없습니다. 다시 확인해 주세요.' });
      if (!members.some((m) => m.studio_id === s.id && m.user_id === me)) members.push({ studio_id: s.id, user_id: me, role: 'member', memo: null, status: 'active', joined_at: new Date().toISOString() });
      return send(200, s);
    }
    if (table === 'rpc/regenerate_invite_code') { const s = studios[args.p_studio_id]; s.invite_code = 'RG' + String(++codeSeq).padStart(4, '0'); return send(200, s.invite_code); }
    if (table === 'rpc/set_member_role') { const m = members.find((x) => x.studio_id === args.p_studio_id && x.user_id === args.p_user_id); m.role = args.p_role; return send(200, m); }
    if (table.startsWith('rpc/')) rpcLog.push({ fn: table.slice(4), args });
    if (table === 'rpc/mark_notifications_read') {
      let n = 0;
      for (const x of notifications) if (x.user_id === me && !x.read_at && (!args.p_ids || args.p_ids.includes(x.id))) { x.read_at = new Date().toISOString(); n++; }
      return send(200, n);
    }
    if (table === 'rpc/add_pass_payment') {
      const ps = passes.find((x) => x.id === args.p_pass_id);
      const row = { id: 'pay' + (payments.length + 1), pass_id: ps.id, member_id: ps.member_id, amount: args.p_amount, method: args.p_method, paid_on: args.p_paid_on, memo: args.p_memo };
      payments.push(row);
      return send(200, row);
    }
    if (table === 'rpc/book_class') return send(200, { id: 'nb1', status: 'confirmed', member_id: args.p_member_id, class_id: args.p_class_id });
    if (table.startsWith('rpc/')) return send(200, { id: args.p_booking_id ?? 'nb', status: args.p_status ?? 'confirmed', pass_refunded: true });

    if (table === 'users') {
      if (req.method === 'PATCH') {
        const u = Object.values(users).find((x) => x.id === eq(q.id));
        if (u && args.name !== undefined) u.name = args.name;
        if (u && args.phone !== undefined) u.phone = args.phone;
        rpcLog.push({ fn: 'users_update', args: { id: eq(q.id), ...args } });
        return send(204, null);
      }
      return out([profileOf(eq(q.id))].filter(Boolean));
    }
    if (table === 'studios') {
      if (req.method === 'PATCH') {
        const s = studios[eq(q.id)];
        if (s && args.name) s.name = args.name;
        rpcLog.push({ fn: 'studios_update', args: { id: eq(q.id), ...args } });
        return send(204, null);
      }
      return out(Object.values(studios).filter((s) => !q.id || s.id === eq(q.id)));
    }
    if (table === 'studio_members') {
      if (req.method === 'PATCH') { const m = members.find((x) => x.studio_id === eq(q.studio_id) && x.user_id === eq(q.user_id)); m.memo = args.memo; return send(204, null); }
      let rows = members.filter((m) => m.status === 'active');
      if (q.user_id && !q.studio_id) return out(rows.filter((m) => m.user_id === eq(q.user_id)).map((m) => ({ ...m, studio: studios[m.studio_id] })));
      rows = rows.filter((m) => m.studio_id === eq(q.studio_id));
      if (q.user_id) rows = rows.filter((m) => m.user_id === eq(q.user_id));
      if ((q.role || '').startsWith('in.')) rows = rows.filter((m) => m.role !== 'member');
      return out(rows.map((m) => ({ role: m.role, memo: m.memo, joined_at: m.joined_at, user: profileOf(m.user_id) })));
    }
    if (table === 'passes' && q.id) return out(passes.filter((x) => x.id === eq(q.id)).map((x) => ({ ...x, member: { id: x.member_id, name: profileOf(x.member_id)?.name } })));
    if (table === 'pass_logs') return out(passLogs[eq(q.pass_id)] ?? []);
    if (table === 'notifications') return out(notifications.filter((x) => x.user_id === me).map((x) => ({ ...x, studio: studios[x.studio_id] ? { name: studios[x.studio_id].name } : null })));
    if (table === 'pass_products') {
      const role = members.find((m) => m.studio_id === 'S1' && m.user_id === me)?.role;
      if (!['owner', 'manager'].includes(role)) return req.method === 'GET' ? out([]) : send(403, { code: '42501', message: 'new row violates row-level security policy' });
      if (req.method === 'POST') { const row = { id: 'pr' + (products.length + 1), sort_order: 0, is_active: true, created_at: new Date(Date.now() + products.length).toISOString(), ...args }; products.push(row); return send(201, null); }
      if (req.method === 'PATCH') { const row = products.find((x) => x.id === eq(q.id)); Object.assign(row, args); return send(204, null); }
      return out(products.filter((x) => x.studio_id === eq(q.studio_id)).sort((a, b) => Number(b.is_active) - Number(a.is_active) || (a.created_at < b.created_at ? -1 : 1)));
    }
    if (table === 'pass_payments') {
      const myRole = members.find((m) => m.studio_id === 'S1' && m.user_id === me)?.role;
      if (myRole !== 'owner') return out([]); // RLS: 원장만
      if (q.pass_id) return out(payments.filter((r) => r.pass_id === eq(q.pass_id)).map((r) => ({ id: r.id, amount: r.amount, method: r.method, paid_on: r.paid_on, memo: r.memo })));
      const pp = url.searchParams.getAll('paid_on');
      const gte = (pp.find((v) => v.startsWith('gte.')) || 'gte.').slice(4);
      const lt = (pp.find((v) => v.startsWith('lt.')) || 'lt.~').slice(3);
      const rows = payments.filter((r) => r.paid_on >= gte && r.paid_on < lt).sort((a, b) => (a.paid_on < b.paid_on ? 1 : -1));
      if ((q.select || '').includes('pass:')) return out(rows.map((r) => ({ ...r, pass: passMeta(r.pass_id), member: { id: r.member_id, name: profileOf(r.member_id)?.name } })));
      return out(rows.map((r) => ({ amount: r.amount })));
    }
    if (table === 'passes' && (q.select || '').includes('payments')) return out(passes.filter((x) => x.studio_id === eq(q.studio_id)).map((x) => ({ id: x.id, payments: payments.filter((r) => r.pass_id === x.id).map((r) => ({ id: r.id })) })).concat([{ id: 'p-unpaid', payments: [] }]));
    if (table === 'passes') return out(passes.filter((x) => x.studio_id === eq(q.studio_id) && (!q.member_id || x.member_id === eq(q.member_id))));
    if (table === 'class_overview') {
      let rows = overview.filter((c) => c.studio_id === eq(q.studio_id));
      if (q.my_booking_status) rows = rows.filter((c) => c.my_booking_status);
      const sp = url.searchParams.getAll('starts_at');
      const gte = (sp.find((v) => v.startsWith('gte.')) || 'gte.').slice(4);
      const lt = (sp.find((v) => v.startsWith('lt.')) || 'lt.~').slice(3);
      return out(rows.filter((c) => c.starts_at >= gte && c.starts_at < lt && (!q.instructor_id || c.instructor_id === eq(q.instructor_id))));
    }
    if (table === 'classes') {
      if (req.method === 'POST') return send(201, []);
      if (req.method === 'PATCH') {
        const c = timeline.find((x) => x.id === eq(q.id));
        if (c) {
          Object.assign(c, args);
          if (args.instructor_id) {
            const p = profileOf(args.instructor_id);
            if (p) c.instructor = { id: p.id, name: p.name };
          }
        }
        rpcLog.push({ fn: 'classes_update', args: { id: eq(q.id), ...args } });
        return send(204, null);
      }
      if (q.id) return out(timeline.filter((c) => c.id === eq(q.id)));
      return out(timeline.filter((c) => c.studio_id === eq(q.studio_id) && (!q.instructor_id || c.instructor_id === eq(q.instructor_id))));
    }
    if (table === 'bookings') {
      // 회원 상세 및 회원 본인 이력: 김하늘(m1)의 다가오는 예약 2건 + 지난 이력 2건
      if (eq(q.member_id) !== 'm1') return out([]);
      const cls = (id, title, day, hour, instr) => ({ id, title, starts_at: at(day, hour), ends_at: at(day, hour, 50), max_capacity: 4, class_type: 'group', instructor_id: instr[0], instructor: { name: instr[1] } });
      return out([
        { id: 'mb1', status: 'confirmed', pass_id: 'p2', pass_refunded: false, promoted_at: null, cancelled_at: null, created_at: '2026-11-17T01:00:00Z', class: cls('k1', '박서연 강사 그룹', 2, 19, ['t1', '박서연']) },
        { id: 'mb2', status: 'confirmed', pass_id: 'p2', pass_refunded: false, promoted_at: null, cancelled_at: null, created_at: '2026-11-17T02:00:00Z', class: cls('k2', '이도윤 원장 그룹', 3, 20, ['a1', '이도윤']) },
        { id: 'mb3', status: 'attended', pass_id: 'p2', pass_refunded: false, promoted_at: null, cancelled_at: null, created_at: '2026-11-12T01:00:00Z', class: cls('k3', '4:1 그룹 리포머', -3, 19, ['t1', '박서연']) },
        { id: 'mb4', status: 'cancelled', pass_id: 'p2', pass_refunded: true, promoted_at: null, cancelled_at: '2026-11-10T01:00:00Z', created_at: '2026-11-09T01:00:00Z', class: cls('k4', '4:1 그룹 리포머', -5, 10, ['a1', '이도윤']) },
      ]);
    }
    return out([]);
  }
  let file = path.join(DIST, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(54321, () => console.log('mock3 on 54321'));
