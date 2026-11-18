// Supabase Edge Function: send-push
// 알림(notifications) 중 아직 휴대폰으로 안 보낸 것을 Expo Push 로 보낸다.
// 호출: Database Webhook(notifications INSERT) 또는 pg_cron/수동 호출. 여러 번 불려도 같은 알림은 한 번만 간다.
// 필요한 비밀값: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY(기본 제공), EXPO_ACCESS_TOKEN(선택: Expo 푸시 보안 설정 시)
import { createClient } from 'npm:@supabase/supabase-js@2';

import { sendPending, type PendingNote, type PushStore } from './core.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const store: PushStore = {
  async claimUnsent(limit) {
    const since = new Date(Date.now() - 24 * 3600e3).toISOString(); // 하루 지난 알림은 휴대폰으로 보내지 않음
    const { data: pending, error } = await supabase
      .from('notifications')
      .select('id')
      .is('push_sent_at', null)
      .gte('created_at', since)
      .order('id')
      .limit(limit);
    if (error) throw error;
    if (!pending?.length) return [];
    const { data, error: claimError } = await supabase
      .from('notifications')
      .update({ push_sent_at: new Date().toISOString() })
      .in('id', pending.map((p) => p.id))
      .is('push_sent_at', null) // 동시에 불린 다른 실행이 먼저 가져간 건 제외
      .select('id, user_id, title, body, data');
    if (claimError) throw claimError;
    return (data ?? []) as PendingNote[];
  },
  async tokensFor(userIds) {
    const { data, error } = await supabase.from('push_tokens').select('token, user_id').in('user_id', userIds);
    if (error) throw error;
    return data ?? [];
  },
  async markError(ids, message) {
    await supabase.from('notifications').update({ push_error: message }).in('id', ids);
  },
  async deleteTokens(tokens) {
    await supabase.from('push_tokens').delete().in('token', tokens);
  },
};

Deno.serve(async () => {
  try {
    const result = await sendPending(store, fetch, { accessToken: Deno.env.get('EXPO_ACCESS_TOKEN') ?? undefined });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});
