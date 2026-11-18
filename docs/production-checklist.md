# 출시 전 체크리스트 (PIQ)

코드 쪽 점검은 `node scripts/check-release.mjs` 로 확인합니다 (ok / warn / fail).
아래는 **대시보드에서 직접 해야 하는 설정**입니다. 위에서부터 순서대로 하면 됩니다.

## 1. Supabase — DB·함수
- [ ] SQL Editor 에서 `supabase/patches/012_withdraw_account.sql` 실행 (이미 했으면 다시 해도 안전)
- [x] `npx supabase@latest functions deploy delete-account --project-ref <ref> --use-api --no-verify-jwt` (2026-11-18 배포 확인, Verify JWT 끔)
- [ ] Database → Cron Jobs 에 `class-reminders`(매일 20:00) · `send-push-retry`(5분) 두 개가 있는지

## 2. Supabase — 로그인(Auth) 설정
- [x] **Authentication → URL Configuration → Redirect URLs** 에 추가 (2026-11-18 완료)
  - `piq://**` (배포 앱·개발 빌드)
  - `exp://**` (Expo Go 로 테스트할 때만)
  - 가입 인증 메일·비밀번호 재설정 메일의 링크가 앱으로 돌아오려면 꼭 필요합니다. 없으면 링크가 Site URL(기본 localhost)로 가서 깨집니다.
- [ ] **Authentication → Sign In / Providers → Email**: "Confirm email" 켜기(권장) — **반드시 커스텀 SMTP 를 먼저 연결한 뒤에**. 기본 메일은 팀원에게만 가므로 SMTP 없이 켜면 일반 회원은 인증 메일을 못 받아 가입을 끝낼 수 없습니다. 비밀번호 최소 길이는 앱과 같은 6자(바꾸면 앱 안내 문구도 함께 수정)
- [ ] **커스텀 SMTP 연결 (출시 필수)**: 기본 메일 발송은 테스트용이라 프로젝트 팀원에게만, 시간당 2통만 보냅니다. Authentication → Emails → SMTP Settings 에서 메일 발송 서비스(Resend, Brevo, AWS SES 등)를 연결하세요. 연결 후 기본 한도는 시간당 30통이고 Authentication → Rate Limits 에서 조절합니다.
- [ ] SMTP 연결 후 **메일 템플릿을 한국어로** (Authentication → Emails → Templates): "Confirm signup", "Reset password" 두 개. 링크 변수 `{{ .ConfirmationURL }}` 는 그대로 두기

- [ ] (선택) Edge Functions → delete-account → Settings 의 "Verify JWT with legacy secret" 끄기 권장. 함수가 직접 로그인 토큰을 확인하므로 꺼도 안전하고, 새 JWT 서명 키로 바꾼 프로젝트에서는 켜 두면 탈퇴 요청이 401 로 막힐 수 있습니다.

## 3. Supabase — 요금제
- [ ] 무료 플랜은 **1주일 동안 사용이 없으면 프로젝트가 일시정지**되고 백업이 없습니다. 실제 스튜디오가 쓰기 시작하면 Pro 플랜(일시정지 없음, 매일 백업 7일 보관)을 권장합니다.

## 4. EAS(Expo) — 빌드 환경 변수
배포 빌드는 PC 의 `.env` 를 쓰지 않습니다. 값이 없으면 앱이 "앱 설정이 필요합니다" 화면만 보여줍니다.
```bash
npx eas-cli login                       # gengarileo
npx eas-cli env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co --visibility plaintext
npx eas-cli env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <publishable 또는 anon 키> --visibility plaintext
# preview / development 환경에도 같은 두 값을 넣기 (--environment preview, development)
```
또는 PC 의 `.env` 를 그대로 올리기 (`.env` 에는 EXPO_PUBLIC_ 두 값만 있음 — 2026-11-18 확인):
```bash
npx eas-cli env:push production --path .env
npx eas-cli env:push preview --path .env
npx eas-cli env:push development --path .env
```
(anon/publishable 키는 앱에 들어가는 공개용 키라 plaintext 로 둬도 됩니다. service_role·secret 키는 절대 넣지 마세요.)

## 4-1. 간편 로그인(카카오·애플·구글)
`docs/social-login-setup.md` 참고. 각 회사 개발자 사이트에서 앱 등록 → Supabase 에 키 입력.

## 5. 빌드
| 목적 | 명령 | 비고 |
|---|---|---|
| 개발 빌드(내 폰에 설치, Expo Go 대신) | `npx eas-cli build --profile development --platform ios` | 알림을 눌렀을 때 앱이 바로 열림 · 안드로이드 푸시도 가능 |
| 내부 테스트(스튜디오에 미리 배포) | `npx eas-cli build --profile preview --platform android` | APK 파일로 설치 |
| 스토어 제출 | `npx eas-cli build --profile production --platform all` → `npx eas-cli submit` | 빌드 번호 자동 증가 |
- iOS 는 Apple Developer 계정(연 $99)이 있어야 실기기·스토어 빌드가 됩니다. 처음 빌드할 때 EAS 가 인증서를 만들어 줍니다.
- 안드로이드 푸시는 Firebase(FCM) 키를 EAS 에 등록해야 합니다: `npx eas-cli credentials` → Android → Push Notifications.

## 6. 스토어 제출 준비
- [ ] `lib/legal.ts` 맨 위 `LEGAL_INFO` 의 [자리표시] 채우기 → 앱에 바로 반영
- [ ] `node --experimental-strip-types scripts/build-legal-site.mjs` 로 `public-site/` 다시 만들고 인터넷에 올리기 (GitHub Pages, Netlify 드래그 앤 드롭 등)
  - 개인정보 처리방침 URL → App Store Connect · Play Console 둘 다 필수
  - 계정 삭제 요청 URL (`delete-account.html`) → Play Console 데이터 보안 양식에 필수 (앱 안 탈퇴와 별도로 웹 링크도 요구)
- [ ] 스토어 표시 이름: "PIQ"는 App Store 에 같은 이름의 앱이 있어 "PIQ - 수업 예약" 처럼 설명을 붙이기
- [ ] 개인정보 수집 항목 답변(App Store "앱 개인정보 보호", Play "데이터 보안"): 이름·이메일·전화번호(선택)·사용자 ID·앱 활동(예약 기록)·구매 기록(결제 기록), 추적·광고 없음, 계정 삭제 제공
- [ ] 심사용 테스트 계정 1개(회원)와 초대 코드 준비 — 심사자가 로그인해서 예약까지 볼 수 있게
