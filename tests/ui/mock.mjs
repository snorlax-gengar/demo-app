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
  'new1@x.com': { id: 'n1', name: '신규원장', phone: null },
  'new2@x.com': { id: 'n2', name: '신규회원', phone: null },
};
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
    if (!users[email]) return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 400 });
    return send(200, { access_token: tokenFor(email), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(now / 1000) + 3600, refresh_token: 'r', user: { id: users[email].id, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } });
  }
  if (p === '/auth/v1/user') { const id = meOf(req); const pr = profileOf(id); return send(200, { id, email: pr.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }); }
  if (p === '/auth/v1/logout') return send(204, null);

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
    if (table === 'rpc/book_class') return send(200, { id: 'nb1', status: 'confirmed', member_id: args.p_member_id, class_id: args.p_class_id });
    if (table.startsWith('rpc/')) return send(200, { id: args.p_booking_id ?? 'nb', status: args.p_status ?? 'confirmed', pass_refunded: true });

    if (table === 'users') return out([profileOf(eq(q.id))].filter(Boolean));
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
    if (table === 'pass_payments') return out([]);
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
      if (q.id) return out(timeline.filter((c) => c.id === eq(q.id)));
      return out(timeline.filter((c) => c.studio_id === eq(q.studio_id) && (!q.instructor_id || c.instructor_id === eq(q.instructor_id))));
    }
    if (table === 'bookings') return out([]);
    return out([]);
  }
  let file = path.join(DIST, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(54321, () => console.log('mock3 on 54321'));
