// 스토어 제출용 공개 웹페이지 생성: 개인정보 처리방침·이용약관·계정 삭제 안내
//   (Google Play 는 앱 밖에서 열리는 처리방침 URL 과 '계정 삭제 요청' 웹 링크를 요구한다)
// usage: node --experimental-strip-types scripts/build-legal-site.mjs [출력폴더=public-site]
// 내용은 앱과 같은 lib/legal.ts 에서 가져오므로, 운영자 정보를 채운 뒤 다시 실행하면 된다.
import fs from 'node:fs';
import path from 'node:path';
import { LEGAL_DOCS, LEGAL_INFO } from '../lib/legal.ts';

const out = path.resolve(process.argv[2] ?? 'public-site');
fs.mkdirSync(out, { recursive: true });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const page = (title, body) => `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(LEGAL_INFO.appName)}</title>
<style>
body{margin:0;background:#F6F5F1;color:#1B1F1E;font:16px/1.7 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
main{max-width:720px;margin:0 auto;padding:40px 20px 64px}
header{display:flex;align-items:center;gap:12px;margin-bottom:28px}
.logo{background:#24766A;color:#fff;font-weight:900;letter-spacing:.06em;border-radius:12px;padding:8px 12px}
h1{font-size:26px;margin:0}h2{font-size:18px;margin:28px 0 6px}
p{margin:0;white-space:pre-line;color:#44403C}.meta{color:#78716C;font-size:14px;margin-bottom:8px}
nav a{color:#1C5D54;margin-right:16px;font-size:14px}.box{background:#fff;border-radius:16px;padding:20px;margin-top:16px}.box h2:first-child{margin-top:0}
</style></head><body><main>
<header><span class="logo">${esc(LEGAL_INFO.appName)}</span><h1>${esc(title)}</h1></header>
<nav><a href="privacy.html">개인정보 처리방침</a><a href="terms.html">이용약관</a><a href="delete-account.html">계정 삭제</a></nav>
${body}
</main></body></html>
`;
const doc = (d) => `<p class="meta">시행일 ${esc(LEGAL_INFO.effectiveDate)}</p>` +
  d.sections.map((s) => `<h2>${esc(s.heading)}</h2><p>${esc(s.body)}</p>`).join('\n');

fs.writeFileSync(path.join(out, 'privacy.html'), page(LEGAL_DOCS.privacy.title, doc(LEGAL_DOCS.privacy)));
fs.writeFileSync(path.join(out, 'terms.html'), page(LEGAL_DOCS.terms.title, doc(LEGAL_DOCS.terms)));
fs.writeFileSync(path.join(out, 'delete-account.html'), page('계정 삭제 요청', `
<div class="box"><h2>앱에서 바로 삭제하기</h2>
<p>${esc(LEGAL_INFO.appName)} 앱 → 내 정보 → 맨 아래 「회원 탈퇴」 → 안내 확인 후 「회원 탈퇴하기」.\n즉시 처리됩니다.</p></div>
<div class="box"><h2>앱이 없을 때</h2>
<p>${esc(LEGAL_INFO.email)} 로 가입한 이메일 주소에서 「${esc(LEGAL_INFO.appName)} 계정 삭제 요청」이라고 보내 주세요.\n본인 확인 후 7일 안에 처리하고 결과를 회신합니다.</p></div>
<div class="box"><h2>삭제되는 정보</h2>
<p>이름, 이메일, 연락처, 스튜디오가 남긴 회원 메모, 알림 내역, 기기 푸시 토큰, 로그인 계정</p>
<h2>남는 정보</h2>
<p>스튜디오 운영·정산을 위한 예약·출석·수강권·결제 기록은 개인을 알아볼 수 없는 「탈퇴 회원」으로 남습니다.\n법령상 보관 의무가 있는 결제 기록은 해당 기간(예: 5년) 동안만 보관합니다.</p></div>`));
fs.writeFileSync(path.join(out, 'index.html'), page(LEGAL_INFO.appName, `<div class="box"><p>스튜디오 수업 예약·수강권 관리 앱 ${esc(LEGAL_INFO.appName)} 의 안내 페이지입니다.\n문의: ${esc(LEGAL_INFO.email)}</p></div>`));
console.log('written', fs.readdirSync(out).map((f) => path.join(path.basename(out), f)).join(', '));
