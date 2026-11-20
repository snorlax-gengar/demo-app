// 출시 전 설정 점검. usage: node scripts/check-release.mjs [out.json]
//   통과(ok) / 확인 필요(warn: 출시 전에 채울 것) / 실패(fail: 빌드·심사에 바로 문제)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const results = [];
const check = (id, title, expected, fn) => {
  let status, actual;
  try { [status, actual] = fn(); } catch (e) { status = 'fail'; actual = e.message; }
  results.push({ id, area: '출시 설정', title, expected, actual, status, pass: status !== 'fail', ms: 0 });
  console.log(status.toUpperCase().padEnd(4), id, title, '—', actual);
};
const pngSize = (p) => { const b = fs.readFileSync(path.join(root, p)); return [b.readUInt32BE(16), b.readUInt32BE(20), b[25]]; };

const app = JSON.parse(read('app.json')).expo;
const eas = JSON.parse(read('eas.json'));

check('TC-R01', '앱 이름·번들 ID·링크 스킴이 서로 맞다', 'name PIQ, iOS·Android 번들 ID 동일(com.gengarileo.piq), scheme piq', () => {
  const ok = app.name === 'PIQ' && app.ios?.bundleIdentifier === 'com.gengarileo.piq' && app.android?.package === 'com.gengarileo.piq' && app.scheme === 'piq';
  return [ok ? 'ok' : 'fail', `name ${app.name} · iOS ${app.ios?.bundleIdentifier} · Android ${app.android?.package} · scheme ${app.scheme} · version ${app.version}`];
});

check('TC-R02', 'EAS 빌드 설정(개발·내부 테스트·배포)과 프로젝트 연결이 있다', 'development(dev client)·preview(내부, APK)·production(빌드 번호 자동 증가), projectId·owner', () => {
  const b = eas.build ?? {};
  const ok = b.development?.developmentClient && b.preview?.distribution === 'internal' && b.production?.autoIncrement && eas.cli?.appVersionSource === 'remote' && app.extra?.eas?.projectId && app.owner;
  const dev = JSON.parse(read('package.json')).dependencies['expo-dev-client'];
  return [ok && dev ? 'ok' : 'fail', `프로필 ${Object.keys(b).join('·')}, 빌드 번호 원격 관리, expo-dev-client ${dev ?? '없음'}, owner ${app.owner}`];
});

check('TC-R03', '아이콘·스플래시 이미지 규격', '아이콘 1024×1024 불투명(iOS 심사), 안드로이드 전경·배경 정사각형', () => {
  const [w, h, color] = pngSize('assets/images/icon.png');
  const fg = pngSize('assets/images/android-icon-foreground.png');
  const opaque = color === 2; // 2 = RGB(알파 없음)
  const ok = w === 1024 && h === 1024 && opaque && fg[0] === fg[1];
  return [ok ? 'ok' : 'fail', `icon ${w}×${h} ${opaque ? '불투명' : '투명 채널 있음'}, 안드로이드 전경 ${fg[0]}×${fg[1]}, 스플래시 배경 ${app.plugins.find((p) => p[0] === 'expo-splash-screen')?.[1]?.backgroundColor}`];
});

check('TC-R04', '암호화 수출 규정 답변이 앱 설정에 들어 있다 (App Store 제출 때마다 묻지 않게)', 'ios.config.usesNonExemptEncryption = false', () => {
  const v = app.ios?.config?.usesNonExemptEncryption;
  return [v === false ? 'ok' : 'warn', `usesNonExemptEncryption ${v}`];
});

check('TC-R05', '비밀 키가 저장소에 없다', 'service_role 키·sb_secret·.env 커밋 0건, .env 는 gitignore', () => {
  const hits = [];
  const walk = (d) => { for (const f of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
    const rel = path.join(d, f.name);
    if (/^(node_modules|\.git|\.expo|dist|test-evidence|Claude outputs)/.test(rel) || rel.includes('node_modules')) continue;
    if (f.isDirectory()) walk(rel);
    else if (/\.(ts|tsx|js|mjs|json|sql|md|py|env)$/.test(f.name) || f.name.startsWith('.env')) {
      if (f.name === '.env') { hits.push(`${rel} (파일 존재 — gitignore 확인)`); continue; }
      const t = fs.readFileSync(path.join(root, rel), 'utf8');
      if (/sb_secret_[A-Za-z0-9]{10,}|"role"\s*:\s*"service_role"|eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}/.test(t)) hits.push(rel);
    }
  } };
  walk('.');
  const ignored = read('.gitignore').split('\n').some((l) => /^\.env/.test(l.trim()));
  const real = hits.filter((h) => !h.includes('(파일 존재'));
  return [real.length === 0 && ignored ? 'ok' : 'fail', `키 문자열 ${real.length}건${real.length ? ': ' + real.join(', ') : ''}, .env gitignore ${ignored ? '예' : '아니오'}`];
});

check('TC-R06', '배포 빌드에 Supabase 주소·키가 빠져도 앱이 꺼지지 않고 안내한다', 'lib/supabase.ts 가 throw 대신 SUPABASE_CONFIG_ERROR 로 안내', () => {
  const s = read('lib/supabase.ts');
  const ok = s.includes('SUPABASE_CONFIG_ERROR') && !/throw new Error/.test(s) && read('app/_layout.tsx').includes('ConfigErrorScreen');
  return [ok ? 'ok' : 'fail', ok ? '설정 누락 시 "앱 설정이 필요합니다" 화면' : '시작 시 오류로 앱이 꺼짐'];
});

check('TC-R07', '약관·개인정보 처리방침의 운영자 정보', '[자리표시] 0개 (출시 전에 채우기)', () => {
  const t = read('lib/legal.ts');
  const body = t.slice(t.indexOf('export const LEGAL_INFO'), t.indexOf('export function isLegalDocId'));
  const holders = [...new Set(body.match(/\[(?!내 정보)[^\]\[\n]{2,30}\]/g) ?? [])];
  return [holders.length ? 'warn' : 'ok', holders.length ? `남은 자리표시 ${holders.length}개: ${holders.join(' ')}` : '모두 채워짐'];
});

check('TC-R08', 'Edge Function 2개와 DB 패치가 모두 저장소에 있다', 'send-push·delete-account, 패치 005~013, schema.sql 에 탈퇴 함수 포함', () => {
  const fns = fs.readdirSync(path.join(root, 'supabase/functions'));
  const patches = fs.readdirSync(path.join(root, 'supabase/patches')).filter((f) => /^0(0[5-9]|1[0-3])_/.test(f));
  const ok = fns.includes('send-push') && fns.includes('delete-account') && patches.length === 9 && read('supabase/schema.sql').includes('withdraw_account');
  return [ok ? 'ok' : 'fail', `함수 ${fns.join('·')}, 패치 ${patches.length}개(005~013)`];
});

check('TC-R09', '스토어 제출용 공개 웹페이지(처리방침·계정 삭제 요청)가 준비돼 있다', 'site/public/privacy.html·delete-account.html·terms.html (호스팅 후 URL 을 스토어에 입력)', () => {
  const dir = path.join(root, 'site', 'public');
  const need = ['privacy.html', 'terms.html', 'delete-account.html'];
  const have = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const missing = need.filter((f) => !have.includes(f));
  if (missing.length) return ['fail', `없음: ${missing.join(', ')} — node --experimental-strip-types scripts/build-legal-site.mjs`];
  const del = fs.readFileSync(path.join(dir, 'delete-account.html'), 'utf8');
  const site = (read('lib/legal.ts').match(/siteUrl: '([^']+)'/) ?? [])[1];
  if (!del.includes('회원 탈퇴')) return ['fail', 'delete-account.html 에 탈퇴 안내 없음'];
  return site ? ['ok', `파일 ${need.length}개 · 공개 주소 ${site} (2026-11-19 배포 확인: /, /privacy.html, /terms.html, /delete-account.html 200)`] : ['warn', `파일 ${need.length}개 생성됨 · 아직 인터넷에 올리지 않음`];
});

check('TC-R10', '간편 로그인(카카오·애플·구글) 앱 설정', 'iOS 애플 로그인 권한(usesAppleSignIn)·플러그인, 앱 주소 스킴, 공급자 키 입력은 대시보드에서', () => {
  const plugins = app.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  const ok = app.ios?.usesAppleSignIn === true && plugins.includes('expo-apple-authentication') && plugins.includes('expo-web-browser') && app.scheme === 'piq';
  return [ok ? 'warn' : 'fail', ok ? '앱 설정 완료 · Supabase 에 카카오·애플·구글 키 입력은 아직 (docs/social-login-setup.md)' : '앱 설정 누락'];
});

check('TC-R11', '앱 색(PIQ 마크 기준)의 글자 대비가 읽기 기준(WCAG AA 4.5:1)을 넘는다', '버튼 흰 글씨·본문·링크·카드 위 글씨 모두 4.5 이상, 마크 민트는 글자 배경으로 안 씀', () => {
  const require = createRequire(import.meta.url);
  const c = require(path.join(root, 'tailwind.config.js')).theme.extend.colors;
  const lum = (h) => { const v = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const pairs = [
    ['버튼(흰 글씨/brand-600)', '#FFFFFF', c.brand[600]],
    ['수강권 카드(흰 글씨/brand-700)', '#FFFFFF', c.brand[700]],
    ['본문(ink/바탕)', c.ink, c.canvas],
    ['카드 글씨(ink/surface)', c.ink, c.surface],
    ['링크(brand-700/바탕)', c.brand[700], c.canvas],
    ['강조 글씨(brand-600/surface)', c.brand[600], c.surface],
    ['민트 위 글씨(ink/brand-400)', c.ink, c.brand[400]],
  ].map(([n, f, b]) => [n, ratio(f, b)]);
  const low = pairs.filter(([, r]) => r < 4.5);
  return [low.length ? 'fail' : 'ok', pairs.map(([n, r]) => `${n} ${r.toFixed(1)}`).join(', ')];
});

const out = process.argv[2];
if (out) fs.writeFileSync(out, JSON.stringify({ results }, null, 2));
const fails = results.filter((r) => r.status === 'fail').length;
console.log(`\nok ${results.filter((r) => r.status === 'ok').length} · warn ${results.filter((r) => r.status === 'warn').length} · fail ${fails}`);
process.exit(fails ? 1 : 0);
