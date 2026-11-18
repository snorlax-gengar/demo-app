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
```
npx supabase@latest login
npx supabase@latest link --project-ref <프로젝트 ref>     # Supabase 주소 https://<ref>.supabase.co 의 <ref>
npx supabase@latest functions deploy send-push
```

## 5. 알림이 쌓이면 함수 호출 (Database Webhook)
Supabase → **Database → Webhooks → Create a new hook**
- Table: `notifications` / Events: **Insert**
- Type: **Supabase Edge Functions** → `send-push`, Method `POST`
- "Add auth header with service key" 켜기 → 저장

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
