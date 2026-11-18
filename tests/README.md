# 자동 테스트

실제 Supabase DB·계정은 건드리지 않습니다.

## DB 규칙 테스트 (`tests/db`)
`supabase/schema.sql` 을 메모리 Postgres(PGlite)에 설치하고, 원장·실장·강사·회원 계정으로
예약·취소·대기 승격·폐강·출석·권한(RLS)을 검증합니다. 케이스 ID: TC-D01 ~ TC-D46 (+ patch_existing.mjs TC-D29, patch007.mjs TC-D36).

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
앱을 웹으로 빌드해 가짜 Supabase 서버(`mock.mjs`)에 연결하고 Playwright 로 클릭·캡처합니다. 케이스 ID: TC-U01 ~ TC-U23.

```bash
# 1) 가짜 서버 주소로 웹 빌드
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 EXPO_PUBLIC_SUPABASE_ANON_KEY=anon npx expo export -p web --output-dir /tmp/dist
# 2) 가짜 서버 실행 (빌드 결과도 함께 서빙)
node tests/ui/mock.mjs /tmp/dist
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
