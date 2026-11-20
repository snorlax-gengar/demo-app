// piq.expo.app 서버 빌드: 처리방침 등 정적 페이지 + /s/<주소> 스튜디오 소개 페이지 (API route)
// usage: node scripts/build-site.mjs   (site/ 에서 npm run build 해도 같다)
// 루트 .env 의 EXPO_PUBLIC_SUPABASE_URL·EXPO_PUBLIC_SUPABASE_ANON_KEY 를 서버 코드에 넣는다 (anon 키는 원래 공개용).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const site = path.join(root, 'site');
const env = { ...process.env };
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(EXPO_PUBLIC_[A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2];
  }
}
for (const k of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']) {
  if (!env[k]) { console.error(`${k} 가 없어요. 루트 .env 를 확인해 주세요.`); process.exit(1); }
}
if (/service_role/.test(Buffer.from((env.EXPO_PUBLIC_SUPABASE_ANON_KEY.split('.')[1] ?? ''), 'base64').toString())) {
  console.error('EXPO_PUBLIC_SUPABASE_ANON_KEY 에 service_role 키가 들어 있어요. anon(publishable) 키로 바꿔 주세요.'); process.exit(1);
}
// 서버(API route) 환경 변수는 번들에 들어가지 않고 eas deploy 때 site/.env.local 에서 함께 올라간다 (.gitignore 의 .env*.local 로 git 에는 안 올라감)
fs.writeFileSync(path.join(site, '.env.local'), ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SITE_URL'].filter((k) => env[k]).map((k) => `${k}=${env[k]}`).join('\n') + '\n');
const node = process.execPath;
execFileSync(node, ['--experimental-strip-types', path.join(root, 'scripts/build-legal-site.mjs'), path.join(site, 'public')], { stdio: 'inherit', cwd: root });
fs.rmSync(path.join(site, 'dist'), { recursive: true, force: true });
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(npx, ['expo', 'export', '-p', 'web', '--output-dir', 'dist'], { stdio: 'inherit', cwd: site, env, shell: process.platform === 'win32' });
console.log('\n완료: site/dist  (미리 보기: cd site && npm run serve)');
