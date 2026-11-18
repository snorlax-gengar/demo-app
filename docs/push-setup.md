# 휴대폰 푸시 알림 설정

알림함(앱의 "알림" 화면)은 패치 010 만 실행하면 바로 동작합니다.
아래 3~5단계는 **휴대폰으로 푸시를 보내기 위한** 설정입니다.

## 언제 알림이 가나요
| 상황 | 받는 사람 | 제목 |
|---|---|---|
| 원장·실장·강사가 대신 예약 | 회원 | 예약이 확정됐어요 |
| 정원이 차서 대신 대기 신청 | 회원 | 대기 신청이 등록됐어요 (대기 N번) |
| 빈자리가 생겨 대기에서 자동 확정 | 회원 | 대기에서 예약이 확정됐어요 |
| 직원이 예약·대기를 취소 | 회원 | 예약이 취소됐어요 (복구 여부 포함) |
| 폐강 | 예약·대기한 회원 전원 | 수업이 폐강됐어요 |
| 수업 전날 20:00 | 확정 예약 회원 | 내일 수업이 있어요 |

회원 본인이 한 예약·취소는 알리지 않습니다.

## 1. 패키지 설치 (Windows, `D:\demo-app`)
```
npm install
```
`expo-notifications`, `expo-device` 가 새로 들어왔습니다.

## 2. DB 패치
1. Supabase → **Database → Extensions** 에서 `pg_cron` 을 켭니다 (전날 알림용).
2. SQL Editor 에서 `supabase/patches/010_notifications.sql` 실행.
   - 결과에 "전날 알림 예약 완료" 가 보이면 OK.
   - pg_cron 을 나중에 켰다면 010 을 한 번 더 실행하세요(다시 실행해도 안전).

## 3. Expo 프로젝트 ID 만들기
```
npx eas-cli@latest login      # 이미 npx expo login 했다면 같은 계정
npx eas-cli@latest init       # app.json 에 extra.eas.projectId 가 추가됨
```
app.json 이 바뀌면 커밋해 주세요(또는 Claude 에게 알려주면 커밋).

## 4. 발송 함수 배포 (Supabase Edge Function)
`D:\demo-app` 에서 (Docker 필요 없음):
```
npx supabase@latest login
npx supabase@latest functions deploy send-push --project-ref <프로젝트 ref> --use-api --no-verify-jwt
```
- `<프로젝트 ref>`: `.env` 의 `EXPO_PUBLIC_SUPABASE_URL` = `https://<ref>.supabase.co` 의 `<ref>` 부분
- `--no-verify-jwt`: DB 가 이 함수를 직접 부르기 위해 필요합니다. 함수는 "아직 안 보낸 알림"만 보내므로 누가 불러도 같은 알림이 두 번 가지 않습니다(더 막고 싶으면 아래 '비밀값' 참고).
- "config.toml 이 없다"는 오류가 나면 `npx supabase@latest init` 을 한 번 실행한 뒤 다시 배포하세요(로컬 설정 파일만 만들고 DB 는 건드리지 않음).

## 5. DB 와 함수 연결 (SQL — Database Webhooks 화면은 쓰지 않음)
1. `supabase/patches/011_push_hook.sql` 을 열어 **`여기에_프로젝트_ref` 한 곳**을 실제 ref 로 바꿉니다.
2. SQL Editor 에서 실행 → 마지막에 `send_push_url | https://<ref>.supabase.co/functions/v1/send-push` 가 보이면 OK.
   - 이제 알림이 쌓일 때마다 DB(pg_net)가 함수를 부르고, pg_cron 이 켜져 있으면 5분마다 한 번 더 확인합니다.

### (선택) 비밀값으로 호출 제한
```
npx supabase@latest secrets set PUSH_SECRET=<아무 긴 문자열> --project-ref <ref>
```
SQL Editor:
```sql
insert into public.app_settings values ('send_push_secret', '<같은 문자열>')
on conflict (key) do update set value = excluded.value;
```

## 6. 확인
1. `npx expo start` 다시 실행 → iPhone Expo Go 로 열기 → **알림 허용**
2. 휴대폰은 **회원 계정**(예: test.member1)으로 로그인
3. 웹에서 원장 계정으로 그 회원을 **대신 예약** → 휴대폰에 "예약이 확정됐어요"
4. 안 오면 Supabase → Table Editor → `notifications` 의 `push_error` 확인
   - `no_token`: 휴대폰에서 알림 허용/로그인이 안 됨 (앱 "알림" 화면 상단 안내 확인)
   - `DeviceNotRegistered`: 앱 삭제 등 → 토큰 자동 삭제됨, 앱 다시 열기

## 참고
- **Android 는 Expo Go 에서 푸시가 오지 않습니다**(SDK 53+). 개발 빌드(`npx eas-cli build --profile development`)가 필요합니다. iPhone Expo Go 는 됩니다.
- 하루 지난 알림은 휴대폰으로 보내지 않고 알림함에만 남습니다.
- 같은 휴대폰에서 다른 계정으로 로그인하면 알림도 새 계정 것만 옵니다(로그아웃 시 토큰 해제).
