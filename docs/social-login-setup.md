# 간편 로그인 설정 (카카오 · 애플 · 구글)

앱 쪽은 준비돼 있습니다. 로그인 화면에 버튼이 있고, 처음 들어온 사람은 이름 확인 + 약관 동의 화면을 거칩니다.
각 회사 개발자 사이트에서 앱을 등록하고, 받은 키를 **Supabase → Authentication → Sign In / Providers** 에 넣으면 켜집니다.
설정 전에 버튼을 누르면 "아직 준비 중인 로그인 방법이에요" 안내가 나옵니다.

공통 콜백 주소 (각 개발자 사이트의 Redirect URI 에 등록):
```
https://rmzorwkithybhiqnaqjl.supabase.co/auth/v1/callback
```
앱으로 돌아오는 주소 `piq://**` 는 Supabase Redirect URLs 에 이미 등록했습니다.

## 1. 카카오
1. https://developers.kakao.com → 내 애플리케이션 → 애플리케이션 추가 (앱 이름 PIQ)
2. **비즈 앱 전환 (개인 개발자 가능)**: 앱 설정 → 비즈니스 → "개인 개발자 비즈 앱 전환" (본인 인증)
   - Supabase 는 카카오에 이메일(account_email)을 함께 요청하므로, 이메일 동의항목을 켤 수 있는 비즈 앱이어야 KOE205 오류가 나지 않습니다.
3. 제품 설정 → 카카오 로그인 → 활성화 ON, Redirect URI 에 위 콜백 주소 등록
4. 제품 설정 → 카카오 로그인 → 동의항목: 닉네임(필수), 프로필 사진(선택), 카카오계정(이메일)(필수 또는 선택)
5. 앱 키 → **REST API 키** 복사, 보안 → **Client Secret** 생성 후 "사용함"
6. Supabase → Sign In / Providers → Kakao → Enable, Client ID = REST API 키, Client Secret 입력 → Save
   - 이메일 동의를 "선택"으로 했다면 "Allow users without an email" 도 켜기

## 2. 애플 (iOS 앱 안에서 기본 애플 로그인 창 사용)
1. Apple Developer(연 $99) → Certificates, Identifiers & Profiles → Identifiers → App ID `com.gengarileo.piq` 에 **Sign In with Apple** 체크
   - EAS 로 처음 iOS 빌드할 때 App ID 를 자동으로 만들고, app.json 의 `usesAppleSignIn` 덕분에 이 기능도 켜 줍니다.
2. Supabase → Sign In / Providers → Apple → Enable, **Client IDs** 에 `com.gengarileo.piq` 입력 → Save
   - iOS 앱에서 기기 애플 로그인으로 받은 토큰을 바로 확인하는 방식이라 Services ID·비밀 키는 필요 없습니다(안드로이드·웹에서 애플 로그인을 붙일 때만 필요).
3. 애플 로그인 버튼은 iPhone 개발 빌드·배포 앱에서만 보입니다 (Expo Go·안드로이드·웹에는 숨김).

## 3. 구글
1. https://console.cloud.google.com → 새 프로젝트 → API 및 서비스 → OAuth 동의 화면 (외부, 앱 이름 PIQ, 지원 이메일)
2. 사용자 인증 정보 → OAuth 클라이언트 ID 만들기 → 유형 **웹 애플리케이션**, 승인된 리디렉션 URI 에 위 콜백 주소
3. 클라이언트 ID / 보안 비밀 → Supabase → Sign In / Providers → Google → Enable 후 입력 → Save
   - 앱은 휴대폰의 앱 안 브라우저로 구글 로그인 페이지를 열기 때문에 iOS·Android 용 클라이언트는 따로 없어도 됩니다.

## 같은 사람이 여러 방법으로 로그인하면
이메일 주소가 같고 확인된 경우 Supabase 가 한 계정으로 자동 연결합니다(예: 이메일 가입 후 같은 주소의 구글로 로그인).
애플에서 "이메일 가리기"를 고르면 별도 주소가 오므로 다른 계정이 됩니다.

## 확인 방법
개발 빌드(`npx eas-cli build --profile development --platform ios`)를 설치 → 로그인 화면에서 각 버튼 → 처음이면 "거의 다 됐어요"(이름·약관) → 스튜디오 참여 화면.
