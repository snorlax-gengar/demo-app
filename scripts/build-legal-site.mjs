// 스토어 제출용 공개 웹페이지 생성: 개인정보 처리방침·이용약관·계정 삭제 안내
//   (Google Play 는 앱 밖에서 열리는 처리방침 URL 과 '계정 삭제 요청' 웹 링크를 요구한다)
// usage: node --experimental-strip-types scripts/build-legal-site.mjs [출력폴더=site/public]
//   site/ 는 EAS Hosting 서버 프로젝트 (/s/<주소> 스튜디오 소개 페이지 포함) — 배포: cd site && npm run deploy
// 내용은 앱과 같은 lib/legal.ts 에서 가져오므로, 운영자 정보를 채운 뒤 다시 실행하면 된다.
import fs from 'node:fs';
import path from 'node:path';
import { LEGAL_DOCS, LEGAL_INFO } from '../lib/legal.ts';

const out = path.resolve(process.argv[2] ?? 'site/public');
fs.mkdirSync(out, { recursive: true });
// 앱과 같은 아이콘을 페이지 로고·파비콘으로 복사
const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
fs.copyFileSync(path.join(rootDir, 'assets/images/favicon.png'), path.join(out, 'favicon.png'));
fs.copyFileSync(path.join(rootDir, 'assets/images/icon.png'), path.join(out, 'icon.png'));
// Google Search Console 소유권 확인 태그 (https://piq.expo.app, 2026-11-19 발급). 지우면 소유권 확인이 풀린다
const SITE_VERIFICATION = process.env.GOOGLE_SITE_VERIFICATION ?? 'O0YCI5U6qO-XEosmKb0IyOpkQ8WdaqrGtYxuAjSDPOQ';
const VERIFY = SITE_VERIFICATION ? `\n<meta name="google-site-verification" content="${SITE_VERIFICATION}" />` : '';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const page = (title, body) => `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/png" href="favicon.png">
<meta name="description" content="PIQ — 필라테스·요가·레슨 스튜디오의 수업 예약과 수강권 관리 앱">${VERIFY}
<title>${title === LEGAL_INFO.appName ? esc(title) : `${esc(title)} · ${esc(LEGAL_INFO.appName)}`}</title>
<style>
body{margin:0;background:#FFFFFF;color:#2F3842;font:16px/1.7 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR",sans-serif}
main{max-width:720px;margin:0 auto;padding:40px 20px 64px}
header{display:flex;align-items:center;gap:12px;margin-bottom:28px}
.logo{display:inline-flex;flex-shrink:0;border-radius:12px;overflow:hidden;border:1px solid #E7E5E4}
h1{font-size:26px;margin:0}h2{font-size:18px;margin:28px 0 6px}
p{margin:0;white-space:pre-line;color:#44403C}.meta{color:#78716C;font-size:14px;margin-bottom:8px}
nav a{color:#0B6E46;margin-right:16px;font-size:14px}.box{background:#F4F7F5;border-radius:16px;padding:20px;margin-top:16px}.box h2:first-child{margin-top:0}
</style></head><body><main>
<header><span class="logo"><img src="icon.png" alt="${esc(LEGAL_INFO.appName)}" width="44" height="44" style="display:block"></span><h1>${esc(title)}</h1></header>
<nav><a href="privacy.html">개인정보 처리방침</a><a href="terms.html">이용약관</a><a href="delete-account.html">계정 삭제</a></nav>
${body}
<footer style="margin-top:40px;padding-top:16px;border-top:1px solid #E6EBE8;font-size:13px;color:#78716C">
${esc(LEGAL_INFO.appName)} · <a href="privacy.html" style="color:#0B6E46">개인정보 처리방침 (Privacy Policy)</a> · <a href="terms.html" style="color:#0B6E46">이용약관 (Terms)</a> · <a href="delete-account.html" style="color:#0B6E46">계정 삭제</a> · 문의 ${esc(LEGAL_INFO.email)}
</footer>
</main></body></html>
`;
const doc = (d) => `<p class="meta">시행일 ${esc(LEGAL_INFO.effectiveDate)}</p>` +
  d.sections.map((s) => `<h2>${esc(s.heading)}</h2><p>${esc(s.body)}</p>`).join('\n');

const PRIVACY_EN = `<h2>Privacy Policy — English summary</h2>
<p>${esc(LEGAL_INFO.appName)} (operated by ${esc(LEGAL_INFO.operator)}) processes only the data needed for class booking and pass management: name, email, optional phone number, studio membership and role, bookings, attendance, passes and payment records, staff memos, and a device push token.

Google user data: if you sign in with Google, we receive only your name, email address and profile picture. We do not access any other Google data (Drive, Gmail, Contacts, etc.). This data is used only to identify you, sign you in and show your name to the studio you join. It is never sold, used for advertising or AI training, or shared with third parties, except that staff of a studio you joined can see it. ${esc(LEGAL_INFO.appName)}'s use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.

Storage and processors: data is stored by Supabase Inc. (servers in Singapore) and push notifications are delivered via Expo (650 Industries, Inc.), Google Firebase Cloud Messaging (Android) and Apple Push Notification service (iOS); studio intro pages are hosted by Expo. All transfers use encrypted connections, and the database uses row-level access control. Children under 14 cannot sign up, and trial requests must be made by a parent or guardian.

Trial class requests: on a studio's public intro page, visitors who are not members can request a trial class by leaving their name, phone number and optional preferred time and message, with explicit consent. This is delivered only to that studio's owner and managers, and is deleted automatically after 180 days or immediately when the studio closes.

Deletion: you can delete your account in the app (My info → Delete account) or request deletion at ${esc(LEGAL_INFO.email)}. Personal data is deleted immediately; booking and payment records remain only in anonymized form ("Withdrawn member"). You can also revoke ${esc(LEGAL_INFO.appName)}'s access at myaccount.google.com/permissions.

Contact: ${esc(LEGAL_INFO.privacyOfficer)}, ${esc(LEGAL_INFO.email)}. Effective date: ${esc(LEGAL_INFO.effectiveDate)}.</p>`;
fs.writeFileSync(path.join(out, 'privacy.html'), page(LEGAL_DOCS.privacy.title, doc(LEGAL_DOCS.privacy) + PRIVACY_EN));
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
const A = esc(LEGAL_INFO.appName);
fs.writeFileSync(path.join(out, 'index.html'), page(LEGAL_INFO.appName, `
<p style="font-size:18px;color:#2F3842;margin:0 0 4px"><b>${A}</b> — 필라테스·요가·레슨 스튜디오를 위한 수업 예약·수강권 관리 앱</p>
<p class="meta">${A} is a class booking and pass management app for small fitness and lesson studios.</p>
<div class="box"><h2>${A} 는 무엇을 하나요?</h2>
<p>스튜디오 원장님이 수업 시간표와 회원의 수강권을 관리하고, 회원은 휴대폰으로 수업을 예약·취소할 수 있게 해 주는 앱입니다.</p></div>
<div class="box"><h2>회원</h2>
<p>· 시간표에서 수업 예약, 정원이 차면 대기 → 빈자리가 생기면 자동 확정\n· 남은 수강권 횟수와 기간 확인\n· 예약 확정·취소·전날 수업 알림</p></div>
<div class="box"><h2>원장·강사</h2>
<p>· 수업 등록과 정원 관리, 출석·노쇼 처리\n· 수강권 발급·연장, 회원 대신 예약\n· 결제 기록과 월별 매출 확인</p></div>
<div class="box"><h2>시작하기</h2>
<p>앱을 설치하고 이메일 또는 카카오·Apple·Google 계정으로 가입한 뒤, 다니는 스튜디오의 초대 코드를 입력하면 됩니다. 원장님은 앱에서 새 스튜디오를 만들 수 있습니다.</p></div>
<div class="box"><h2>개인정보</h2>
<p>${A} 는 수업 예약과 수강권 관리에 필요한 정보(이름, 이메일, 연락처(선택), 예약·출석·결제 기록)만 처리합니다. Google 로그인 시에는 이름·이메일·프로필 사진만 받으며 다른 Google 데이터에는 접근하지 않습니다.\n자세한 내용은 <a href="privacy.html" style="color:#0B6E46">개인정보 처리방침</a>을 확인해 주세요.</p></div>
<div class="box"><h2>About ${A} (English)</h2>
<p>${A} helps studio owners manage class schedules, members' passes, attendance and payments, and lets members book or cancel classes and receive reminders on their phones. Sign-in is available with email, Kakao, Apple or Google. With Google sign-in, ${A} only receives your name, email address and profile picture, used solely to identify your account. See our <a href="privacy.html" style="color:#0B6E46">Privacy Policy</a>.</p></div>`));
console.log('written', fs.readdirSync(out).map((f) => path.join(path.basename(out), f)).join(', '));
