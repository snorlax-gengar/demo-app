// 회원 탈퇴 처리 순서 (Deno·Node 공용, 테스트 가능하도록 외부 의존을 주입받는다)
//   1) 요청한 사람 확인(로그인 토큰)  2) withdraw_account() — 개인정보 삭제·기록 익명화(그 사람 권한으로)
//   3) 로그인 계정 소프트 삭제(관리자 권한) — 행을 지우지 않으므로 기록이 연쇄 삭제되지 않는다
// 2)가 막히면(유일한 원장 등) 계정은 그대로. 3)이 실패하면 다시 시도할 수 있다(2는 두 번 불러도 안전).

export interface WithdrawResult {
  already: boolean;
  cancelled_bookings: number;
}

export interface DeleteAccountDeps {
  userId(): Promise<string | null>;
  withdraw(): Promise<WithdrawResult>;
  softDelete(userId: string): Promise<void>;
}

export interface DeleteAccountResponse {
  status: number;
  body: { ok: true; cancelledBookings: number } | { error: string; retryable?: boolean };
}

export async function deleteAccount(deps: DeleteAccountDeps): Promise<DeleteAccountResponse> {
  const uid = await deps.userId().catch(() => null);
  if (!uid) return { status: 401, body: { error: '로그인이 필요합니다. 다시 로그인한 뒤 시도해 주세요.' } };

  let result: WithdrawResult;
  try {
    result = await deps.withdraw();
  } catch (e) {
    return { status: 400, body: { error: e instanceof Error ? e.message : String(e) } };
  }

  try {
    await deps.softDelete(uid);
  } catch {
    return { status: 500, body: { error: '계정 삭제를 마치지 못했어요. 잠시 후 다시 시도해 주세요.', retryable: true } };
  }
  return { status: 200, body: { ok: true, cancelledBookings: result.cancelled_bookings ?? 0 } };
}
