# 자동 테스트

실제 Supabase DB·계정은 건드리지 않습니다.

## DB 규칙 테스트 (`tests/db`)
`supabase/schema.sql` 을 메모리 Postgres(PGlite)에 설치하고, 원장·실장·강사·회원 계정으로
예약·취소·대기 승격·폐강·출석·권한(RLS)을 검증합니다. 케이스 ID: TC-D01 ~ TC-D61 (+ patch_existing.mjs TC-D29, patch007.mjs TC-D36).

```bash
cd tests/db
npm install
npm test                      # 수정된 schema.sql 검증 → result.json
# 패치 검증: 예전 schema + 패치 파일
node cases.mjs <예전 schema.sql> result.json ../../supabase/patches/005_auto_promotion_actor.sql
# 기존 기록 정리 검증 (TC-D29)
node patch_existing.mjs <예전 schema.sql> d29.json ../../supabase/patches/005_auto_promotion_actor.sql
```

## 화면 테스트 (`tests/ui`)
앱을 웹으로 빌드해 가짜 Supabase 서버(`mock.mjs`)에 연결하고 Playwright 로 클릭·캡처합니다. 케이스 ID: TC-U01 ~ TC-U53 (TC-U49~U52 는 공개 소개 페이지 `site/` 를 함께 띄워야 함).

```bash
# 1) 가짜 서버 주소로 웹 빌드
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_ANON_KEY=anon npx expo export -p web --output-dir /tmp/dist
# 2) 가짜 서버 실행 (빌드 결과도 함께 서빙)
node tests/ui/mock.mjs /tmp/dist
# 2-1) 공개 소개 페이지(서버) 빌드·실행 → http://127.0.0.1:8090/s/demo-pilates
(cd site && EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_ANON_KEY=anon npx expo export -p web --output-dir dist \
  && EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_ANON_KEY=anon npx expo serve --port 8090)
# 3) 다른 터미널에서 (pip install playwright && playwright install chromium)
python tests/ui/ui_cases.py tests/ui/shots ui.json
```

## 증적 보고서
`build_report.py` 는 같은 폴더에 있는 결과 JSON·캡처(jpg)를 모아 단일 HTML 보고서를 만듭니다.
보고서는 `test-evidence/` 에 두며 git 에는 올리지 않습니다.

## 푸시 발송 로직 테스트 (`supabase/functions/send-push/core.test.mjs`)
Edge Function 의 발송 로직을 가짜 DB·가짜 Expo 서버로 검증합니다. 케이스 ID: TC-P01 ~ TC-P04.
```bash
node --experimental-strip-types supabase/functions/send-push/core.test.mjs push.json   # Node 22+
```

## 회원 탈퇴 로직 테스트 (`supabase/functions/delete-account/core.test.mjs`)
Edge Function 의 탈퇴 순서(본인 확인 → 익명화 → 로그인 계정 소프트 삭제)를 가짜 의존성으로 검증합니다. 케이스 ID: TC-W01 ~ TC-W04.
```bash
node --experimental-strip-types supabase/functions/delete-account/core.test.mjs withdraw.json
```

## 보안 점검 (`tests/db/audit.mjs`)
Supabase 기본 권한(새 표·함수를 anon/authenticated 에 전부 허용)을 재현한 뒤 schema.sql 을 설치하고
RLS·비로그인 차단·직접 쓰기 권한·SECURITY DEFINER 설정·내부 함수 차단을 확인합니다. 케이스 ID: TC-S01 ~ TC-S07.
```bash
cd tests/db && node audit.mjs ../../supabase/schema.sql audit.json
```

## 출시 설정 점검 (`scripts/check-release.mjs`)
앱 이름·번들 ID·EAS 설정·아이콘 규격·비밀 키 유출·약관 자리표시·공개 웹페이지를 확인합니다 (ok / warn / fail). 케이스 ID: TC-R01 ~ TC-R09.
```bash
node scripts/check-release.mjs release.json
```
