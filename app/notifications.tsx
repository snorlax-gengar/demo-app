import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { BRAND, EmptyView, ErrorView, LoadingView, Screen } from '@/components/ui';
import { useMarkNotificationsRead, useNotifications, type AppNotification } from '@/hooks/queries';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { dayjs } from '@/lib/date';
import { PUSH_STATUS_TEXT, usePushStore } from '@/lib/push';

const KIND_ICON: Record<string, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
  booked_by_staff: { name: 'checkmark-circle', color: '#24766A' },
  promoted: { name: 'arrow-up-circle', color: '#24766A' },
  waitlisted_by_staff: { name: 'time', color: '#B45309' },
  cancelled_by_staff: { name: 'close-circle', color: '#78716C' },
  class_cancelled: { name: 'alert-circle', color: '#E11D48' },
  reminder: { name: 'notifications', color: '#2F8F7A' },
};

/** 알림함: 예약 확정·대기 승격·취소·폐강·전날 알림. 열면 모두 읽음 처리 */
export default function NotificationsScreen() {
  const router = useRouter();
  const query = useNotifications();
  const pull = usePullRefresh(query.refetch);
  const markRead = useMarkNotificationsRead();
  const pushStatus = usePushStore((s) => s.status);
  const marked = useRef(false);

  const unread = (query.data ?? []).filter((n) => !n.read_at).length;
  useEffect(() => {
    // 화면을 연 뒤 잠깐 '새 알림' 표시를 보여주고 읽음 처리
    if (marked.current || !query.data || unread === 0) return;
    marked.current = true;
    const t = setTimeout(() => markRead.mutate(undefined), 1500);
    return () => clearTimeout(t);
  }, [query.data, unread, markRead]);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <Screen>
      <View className="flex-row items-center px-3 py-2">
        <Pressable onPress={goBack} accessibilityLabel="뒤로" className="h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
          <Ionicons name="chevron-back" size={24} color="#1B1F1E" />
        </Pressable>
        <Text className="ml-1 flex-1 text-lg font-bold text-ink">알림</Text>
      </View>
      {query.isLoading ? (
        <LoadingView />
      ) : query.isError ? (
        <ErrorView message={query.error.message} onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={BRAND} />}>
          {pushStatus !== 'registered' && pushStatus !== 'idle' ? (
            <View className="mb-3 flex-row items-start rounded-2xl bg-stone-100 px-4 py-3">
              <Ionicons name="phone-portrait-outline" size={16} color="#78716C" style={{ marginTop: 2 }} />
              <Text className="ml-2 flex-1 text-xs leading-5 text-stone-600">{PUSH_STATUS_TEXT[pushStatus]}</Text>
            </View>
          ) : null}
          {(query.data ?? []).length === 0 ? (
            <EmptyView icon="notifications-outline" title="아직 알림이 없습니다" description="대신 예약·대기 확정·취소·폐강·수업 전날 알림이 여기에 쌓입니다." />
          ) : (
            <View className="rounded-2xl bg-white px-4">
              {(query.data ?? []).map((n, i) => (
                <Row key={n.id} n={n} first={i === 0} />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

function Row({ n, first }: { n: AppNotification; first: boolean }) {
  const icon = KIND_ICON[n.kind] ?? { name: 'notifications', color: '#78716C' };
  const [headline, ...rest] = n.body.split('\n');
  return (
    <View accessibilityLabel={`알림 ${n.title}`} className={`flex-row py-3.5 ${first ? '' : 'border-t border-stone-100'}`}>
      <Ionicons name={icon.name} size={22} color={icon.color} style={{ marginTop: 1 }} />
      <View className="ml-3 flex-1">
        <View className="flex-row items-center">
          <Text className="flex-1 text-base font-bold text-ink">{n.title}</Text>
          {!n.read_at ? <View accessibilityLabel="새 알림" className="ml-2 h-2 w-2 rounded-full bg-rose-500" /> : null}
        </View>
        <Text className="mt-0.5 text-sm text-ink">{headline}</Text>
        {rest.length ? <Text className="mt-0.5 text-sm text-stone-500">{rest.join(' ')}</Text> : null}
        <Text className="mt-1 text-xs text-stone-400">
          {n.studio?.name ? `${n.studio.name} · ` : ''}
          {dayjs(n.created_at).format('M월 D일 HH:mm')}
        </Text>
      </View>
    </View>
  );
}
