# Studio — 필라테스/과외 예약 앱 MVP

여러 스튜디오(필라테스 센터, 1:1·소그룹 과외 선생님 등)가 각자 쓰는 단일 앱입니다.

- 한 계정이 여러 스튜디오에 속할 수 있고, **역할은 스튜디오마다** 다릅니다: 원장(owner, 여러 명 가능) / 관리자(manager) / 강사(instructor) / 회원(member)
- 지금 선택된 스튜디오에서의 역할에 따라 하단 탭과 접근 가능한 화면이 자동으로 갈립니다. 스튜디오 전환은 '내 정보'에서.
- 누구나 스튜디오를 만들 수 있고(만든 사람 = 원장), 다른 사람은 **초대 코드**로 회원으로 들어옵니다. 강사·관리자는 원장이 회원 상세에서 역할을 바꿔 줍니다.
- 다른 스튜디오의 데이터는 어떤 역할이든 보이지 않습니다(DB RLS 로 강제).

- Expo SDK 58 (React Native 0.88, React 19.3, Expo Router, TypeScript)
- NativeWind 4.2 (Tailwind CSS 3.4)
- Supabase (PostgreSQL, Auth, RLS)
- TanStack Query(서버 상태) + Zustand(세션, 원장 토글)

## 폴더 구조

```
studio-app/
├── app/
│   ├── _layout.tsx              # 세션 복원 + 소속 여부·현재 스튜디오 역할별 Stack.Protected 분기
│   ├── (onboarding)/index.tsx   # 소속 없는 새 계정: 초대 코드로 참여 / 스튜디오 만들기
│   ├── add-studio.tsx           # 이미 소속이 있는 사람이 스튜디오 추가
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── index.tsx            # 로그인
│   │   └── signup.tsx           # 회원가입
│   ├── (member)/                # role = member
│   │   ├── _layout.tsx          # 탭: 홈 / 시간표 / 내 정보
│   │   ├── index.tsx            # 홈: 수강권 카드(가로 스크롤) + 다가오는 예약
│   │   ├── schedule.tsx         # 주간 시간표 + 예약/대기/취소
│   │   └── profile.tsx
│   └── (admin)/                 # role = owner | manager | instructor
│       ├── _layout.tsx          # Stack: 탭 + 상세/등록 화면
│       ├── (tabs)/
│       │   ├── _layout.tsx      # 탭: 오늘 / 달력 / 회원 / 내 정보
│       │   ├── index.tsx        # 오늘 타임라인 + 출석/노쇼 원클릭 + (원장) 전체 강사 토글
│       │   ├── calendar.tsx     # 월간 달력 + 일간 시간표(빈 시간 탭 → 수업 등록)
│       │   ├── members.tsx      # 회원 목록: 유형별 잔여 횟수·만료일, 재등록 대상 필터
│       │   └── profile.tsx
│       ├── class/new.tsx        # 수업 등록 (1:1/그룹, 정원, 매주 반복)
│       ├── class/[id].tsx       # 수업 상세: 출석부 + 정원 변경 + 폐강
│       ├── pass/new.tsx         # 수강권 발급 (유형·횟수·기간·결제 금액)
│       ├── pass/[id].tsx        # 수강권 상세: 기간 연장·횟수 조정·사용 중지 + 변동 내역
│       └── member/[id].tsx      # 회원 상세: 수강권 + 예약 + 출석/노쇼/취소 이력
├── components/
│   ├── form.tsx                 # 입력 화면 공용 부품(칩, ± 버튼 등)
│   ├── ClassCard.tsx            # 수업 카드 (3/4명, 대기 2명 배지 + 예약 버튼)
│   ├── PassCard.tsx             # 수강권 카드
│   ├── StaffClassCard.tsx       # 강사용 수업 카드 (출석부 + 회원별 잔여 횟수)
│   ├── ProfileScreen.tsx        # 내 정보: 초대 코드, 스튜디오 전환·추가
│   ├── StudioSetup.tsx          # 참여·만들기 공용 화면
│   └── ui.tsx                   # Screen, Badge, 빈/오류/로딩 뷰, 탭 바 옵션
├── hooks/
│   ├── queries.ts               # 모든 조회·RPC 호출 (TanStack Query)
│   ├── useBookingActions.ts     # 예약/취소 확인 흐름
│   └── useStudio.ts             # 현재 스튜디오 + 내 역할(isOwner/isAdmin/isStaff)
├── lib/                         # supabase 클라이언트, 타입, 날짜, 라벨
├── stores/                      # auth(세션·프로필·소속·현재 스튜디오), adminView(전체 강사 토글)
├── supabase/
│   ├── schema.sql               # v2 전체 DDL + RLS + 함수/트리거 (멀티 스튜디오)
│   ├── patches/000_drop_v1.sql  # v1(단일 스튜디오)을 이미 실행했다면 schema.sql 전에 1회
│   ├── patches/003_passes_and_owners.sql  # v2 를 이미 실행했다면 1회 (원장 여러 명 + 수강권 관리)
│   └── seed.sql                 # 데모 스튜디오(초대 코드 DEMO22)·수업·수강권
└── (설정) app.json, babel.config.js, metro.config.js, tailwind.config.js, global.css
```

## 실행 방법

1. Supabase SQL Editor 에서 `supabase/schema.sql` 전체를 실행합니다.
   v1 을 이미 실행했다면 **먼저** `supabase/patches/000_drop_v1.sql` 을 실행합니다(테스트 데이터 삭제, 로그인 계정은 유지).
2. `.env.example` 을 `.env` 로 복사해 URL 과 키를 채웁니다.
3. 설치 후 실행합니다.
   ```bash
   npm install
   npx expo start
   ```
4. 둘 중 하나로 시작합니다.
   - 앱에서 바로: 가입 → '새 스튜디오 만들기' → 내 정보의 초대 코드로 다른 계정 참여 → 회원 상세에서 강사로 지정
   - 데모 데이터로: 계정 몇 개 가입 후 `supabase/seed.sql` 의 두 이메일을 바꿔 실행 → '데모 필라테스'(초대 코드 DEMO22)에 수업·수강권 생성

개발 중에는 Supabase Dashboard > Authentication 에서 이메일 인증(Confirm email)을 꺼 두면 가입 즉시 로그인됩니다.

## 비즈니스 규칙이 구현된 위치

| 규칙 | 위치 |
| --- | --- |
| 정원 1 = 1:1, 그 외 = 그룹 | `classes.class_type` (generated column) |
| 예약 확정 시 유형에 맞는 수강권 1회 차감 | `book_class()` |
| 그룹 만석 시 대기 등록(차감 없음) | `book_class()` |
| 확정 취소 시 대기 1순위 자동 승격 + 차감 | 트리거 `bookings_promote_on_cancel` → `_promote_waitlist()` |
| 24시간 전 취소만 횟수 복구 | `cancel_booking()` |
| 노쇼는 복구 없음 | `mark_attendance()` (차감 상태 유지) |
| 스튜디오 간 데이터 격리 | 모든 테이블 `studio_id` + RLS(`is_studio_member/staff/admin`), `class_overview` WHERE |
| 역할 변경 규칙(원장·관리자 지정은 원장만, 본인 변경 금지 → 원장 0명 불가) | `set_member_role()` |
| 수강권 발급·연장·조정·중지는 함수로만, 전부 변동 내역 기록 | `issue_pass / extend_pass / admin_adjust_pass / set_pass_active` |
| 결제 금액은 원장만 조회 | `pass_payments` RLS |
| 강사는 본인 수업만, 원장·관리자만 전체 보기 토글 | `app/(admin)/(tabs)/index.tsx`, `calendar.tsx` |
| 횟수 변동 전부 기록 | `_apply_pass_delta()` → `pass_logs` |
| 같은 스튜디오에서 같은 강사 수업 시간 중복 금지 | `classes_no_instructor_overlap` (exclusion constraint) |
| 정원을 예약 인원 아래로 / 예약 있는 수업의 1:1↔그룹 전환 금지 | 트리거 `classes_guard_update` |
| 수업 삭제 금지(폐강만 허용 → 수강권 복구) | `classes` DELETE 권한 회수 |

클라이언트는 `bookings`, `pass_logs` 에 직접 쓸 수 없고(RLS 쓰기 정책 없음), 예약·취소·출석은 모두 DB 함수로만 처리됩니다.

## MVP 에서 정한 세부 규칙

- 1:1 수업은 만석이면 대기 없이 '마감'입니다.
- 대기 신청에는 유효한 수강권이 필요하고, 차감은 승격 시점에 일어납니다. 승격 시점에 유효한 수강권이 없는 대기자는 건너뜁니다.
- 강사/원장이 회원 대신 취소할 때는 횟수 복구 여부를 직접 고릅니다.
- 수강권 유효기간은 한국 시간(Asia/Seoul) 기준 수업일로 판정합니다.
- 수강권 발급은 원장·관리자가 회원 상세 → '발급'에서. 결제 금액은 선택 입력이며 원장만 볼 수 있습니다(추후 매출 화면용).
- 사용 중지한 수강권은 새 예약에 쓰이지 않지만, 이미 잡힌 예약은 유지됩니다.
- 회원은 다닌 스튜디오의 수강권으로만 그 스튜디오 수업을 예약할 수 있습니다.
- 스튜디오 탈퇴, 매출 화면은 아직 없습니다. 원장은 여러 명 둘 수 있으므로 '양도'는 새 원장 지정 후 기존 원장 해제로 됩니다.
- 반복 등록은 한 번에 INSERT 하므로, 그중 하나라도 같은 강사 시간과 겹치면 전체가 등록되지 않습니다.
- 잔여 횟수 '주의' 기준: 잔여 3회 이하 또는 만료 7일 이내 (`lib/passes.ts` 의 상수로 조정).
