// 푸시 발송 핵심 로직 (Deno·Node 공용, 외부 의존성 없음)
// 아직 안 보낸 알림을 '선점'(push_sent_at 기록)한 뒤 Expo Push API 로 보낸다.
// 같은 알림을 두 번 보내지 않도록 선점은 push_sent_at IS NULL 인 행만 갱신한다.

export interface PendingNote {
  id: number;
  user_id: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
}

export interface PushStore {
  /** 보내지 않은 알림을 최대 limit 개 선점해 돌려준다 */
  claimUnsent(limit: number): Promise<PendingNote[]>;
  tokensFor(userIds: string[]): Promise<{ token: string; user_id: string }[]>;
  markError(ids: number[], error: string): Promise<void>;
  deleteTokens(tokens: string[]): Promise<void>;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface SendResult {
  claimed: number;
  messages: number;
  ok: number;
  noToken: number;
  failed: number;
  removedTokens: number;
}

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100; // Expo 한 번 요청 최대 100건

interface Ticket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

export async function sendPending(store: PushStore, fetchFn: FetchLike, opts: { limit?: number; accessToken?: string } = {}): Promise<SendResult> {
  const notes = await store.claimUnsent(opts.limit ?? 200);
  const result: SendResult = { claimed: notes.length, messages: 0, ok: 0, noToken: 0, failed: 0, removedTokens: 0 };
  if (notes.length === 0) return result;

  const tokens = await store.tokensFor([...new Set(notes.map((n) => n.user_id))]);
  const byUser = new Map<string, string[]>();
  for (const t of tokens) byUser.set(t.user_id, [...(byUser.get(t.user_id) ?? []), t.token]);

  const noToken = notes.filter((n) => !byUser.has(n.user_id));
  if (noToken.length) {
    await store.markError(noToken.map((n) => n.id), 'no_token');
    result.noToken = noToken.length;
  }

  const messages = notes.flatMap((n) =>
    (byUser.get(n.user_id) ?? []).map((to) => ({
      noteId: n.id,
      payload: { to, title: n.title, body: n.body, data: n.data ?? {}, sound: 'default', channelId: 'default', priority: 'high' },
    })),
  );
  result.messages = messages.length;

  const failedNotes = new Map<number, string>();
  const okNotes = new Set<number>();
  const deadTokens = new Set<string>();
  for (let i = 0; i < messages.length; i += BATCH) {
    const chunk = messages.slice(i, i + BATCH);
    const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;
    let tickets: Ticket[] = [];
    try {
      const res = await fetchFn(EXPO_URL, { method: 'POST', headers, body: JSON.stringify(chunk.map((m) => m.payload)) });
      const json = (await res.json()) as { data?: Ticket[]; errors?: { message?: string }[] };
      if (!res.ok || !Array.isArray(json.data)) throw new Error(json.errors?.[0]?.message ?? `HTTP ${res.status}`);
      tickets = json.data;
    } catch (e) {
      for (const m of chunk) failedNotes.set(m.noteId, `send_failed: ${e instanceof Error ? e.message : String(e)}`);
      result.failed += chunk.length;
      continue;
    }
    chunk.forEach((m, j) => {
      const t = tickets[j];
      if (t?.status === 'ok') {
        result.ok += 1;
        okNotes.add(m.noteId);
        return;
      }
      result.failed += 1;
      if (t?.details?.error === 'DeviceNotRegistered') deadTokens.add(m.payload.to);
      failedNotes.set(m.noteId, t?.details?.error ?? t?.message ?? 'unknown');
    });
  }

  // 한 사람이 여러 기기면 하나라도 성공했으면 실패로 기록하지 않는다
  const errorsByMessage = new Map<string, number[]>();
  for (const [id, err] of failedNotes) {
    if (okNotes.has(id)) continue;
    errorsByMessage.set(err, [...(errorsByMessage.get(err) ?? []), id]);
  }
  for (const [err, ids] of errorsByMessage) await store.markError(ids, err);
  if (deadTokens.size) {
    await store.deleteTokens([...deadTokens]);
    result.removedTokens = deadTokens.size;
  }
  return result;
}
