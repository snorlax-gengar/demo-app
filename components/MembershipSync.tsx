import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useNotifications } from '@/hooks/queries';
import { queryClient } from '@/lib/queryClient';
import { useAuthStore } from '@/stores/auth';

/** 내 소속이 바뀌는 알림 (스튜디오 운영 종료 등) */
const MEMBERSHIP_KINDS = new Set(['studio_closed', 'close_request_approved']);

/**
 * 소속 정보 최신화 (F-09). 앱을 켜 둔 채 스튜디오가 운영 종료되면 내 스튜디오 목록이 예전 그대로 남던 문제:
 *  · 운영 종료 알림이 새로 들어오면 소속을 다시 불러온다 (알림함은 1분마다·푸시 수신 시 갱신)
 *  · 앱이 다시 앞으로 올 때도 소속과 알림을 다시 불러온다 (15초에 한 번까지)
 * 소속이 모두 없어지면 화면 가드가 스튜디오 만들기/참여 화면으로 보낸다.
 */
export function MembershipSync() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const accountLoaded = useAuthStore((s) => s.accountLoaded);
  const { data } = useNotifications();
  const seen = useRef<number | null>(null);

  useEffect(() => {
    seen.current = null;
  }, [userId]);

  useEffect(() => {
    if (!data || !accountLoaded) return;
    const latest = data.filter((n) => MEMBERSHIP_KINDS.has(n.kind)).reduce((max, n) => Math.max(max, n.id), 0);
    if (seen.current === null) {
      seen.current = latest; // 처음 불러온 알림은 기준점 (소속은 로그인 때 이미 최신)
      return;
    }
    if (latest > seen.current) {
      seen.current = latest;
      void useAuthStore.getState().loadAccount();
    }
  }, [data, accountLoaded]);

  useEffect(() => {
    if (!userId) return;
    let last = 0;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const now = Date.now();
      if (now - last < 15_000) return;
      last = now;
      void useAuthStore.getState().loadAccount();
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    return () => sub.remove();
  }, [userId]);

  return null;
}
