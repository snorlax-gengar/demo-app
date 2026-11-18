import { useCallback, useRef, useState } from 'react';

/**
 * 당겨서 새로고침 전용 상태.
 * RefreshControl 에 query.isRefetching 을 그대로 주면 배경 새로고침(알림 읽음 처리, 주기 갱신, 푸시 수신 등)
 * 때도 스피너가 돌고 iOS 에서는 목록이 밀린 채 남는다 → 사용자가 직접 당겼을 때만 true.
 */
export function usePullRefresh(...refetchers: (() => Promise<unknown>)[]) {
  const latest = useRef(refetchers);
  latest.current = refetchers;
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all(latest.current.map((r) => r()));
    } finally {
      setRefreshing(false);
    }
  }, []);
  return { refreshing, onRefresh };
}
