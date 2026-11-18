import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export interface WithdrawOutcome {
  ok: boolean;
  message?: string;
  cancelledBookings?: number;
}

/** 회원 탈퇴 (Edge Function delete-account). 막히는 사유(유일한 원장 등)는 DB 안내 문구 그대로 돌려준다 */
export async function withdrawAccount(): Promise<WithdrawOutcome> {
  const { data, error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (!error) return { ok: true, cancelledBookings: (data as { cancelledBookings?: number })?.cancelledBookings ?? 0 };
  if (error instanceof FunctionsHttpError) {
    const body = await error.context.json().catch(() => null);
    if (body?.error) return { ok: false, message: String(body.error) };
  }
  return { ok: false, message: '탈퇴 처리를 하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.' };
}
