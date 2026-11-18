# 회원 탈퇴 설정 (패치 012 + delete-account 함수)

탈퇴하면 개인정보(이름·연락처·이메일·회원 메모·푸시 토큰·알림)는 지우고,
예약·출석·수강권·결제 기록은 "탈퇴 회원"으로 남깁니다. 로그인 계정은 소프트 삭제합니다.

## 1. DB 패치
Supabase → SQL Editor 에서 `supabase/patches/012_withdraw_account.sql` 전체 실행 (다시 실행해도 안전).

## 2. Edge Function 배포
```bash
npx supabase@latest functions deploy delete-account --project-ref <ref> --use-api
```
- `send-push` 와 달리 **`--no-verify-jwt` 를 붙이지 않습니다** (로그인한 본인만 호출 가능해야 함).
- 필요한 값(SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)은 Supabase 가 자동으로 넣어 줍니다.

## 3. 확인
앱 → 내 정보 → 맨 아래 "회원 탈퇴".
- 유일한 원장(다른 사람이 남은 스튜디오)·진행 예정 수업 담당 강사는 안내와 함께 막힙니다.
- 탈퇴 후 같은 이메일로 새로 가입할 수 있습니다(새 계정, 이전 기록과 연결되지 않음).
- 함수 배포 전에 누르면 "탈퇴 처리를 하지 못했어요" 안내가 뜨고 아무것도 바뀌지 않습니다.
