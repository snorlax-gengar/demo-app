import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Badge, BRAND, EmptyView, ErrorView, LoadingView, Screen } from '@/components/ui';
import { useMyBookingHistory } from '@/hooks/queries';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { useStudio } from '@/hooks/useStudio';
import { dayjs, formatDay, formatTimeRange } from '@/lib/date';
import { BOOKING_STATUS_LABEL, BOOKING_STATUS_TONE, classTypeLabel } from '@/lib/labels';
import type { MemberBooking } from '@/lib/types';
import { useAuthStore } from '@/stores/auth';

type Filter = 'all' | 'attended' | 'no_show' | 'cancelled';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'attended', label: '출석' },
  { key: 'no_show', label: '노쇼' },
  { key: 'cancelled', label: '취소' },
];

/** 회원 본인용 지난 수업 이력 (출석·노쇼·취소) */
export default function MyHistoryScreen() {
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const { studioId, studio } = useStudio();
  const query = useMyBookingHistory(studioId, profile?.id);
  const pull = usePullRefresh(query.refetch);
  const [filter, setFilter] = useState<Filter>('all');

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const { history, stats } = useMemo(() => {
    const now = dayjs();
    const bookings = (query.data ?? []).filter((b) => b.class !== null);
    const isUpcoming = (b: MemberBooking) =>
      (b.status === 'confirmed' || b.status === 'waitlist') && dayjs(b.class!.starts_at).isAfter(now);

    const past = bookings
      .filter((b) => !isUpcoming(b))
      .sort((a, b) => dayjs(b.class!.starts_at).valueOf() - dayjs(a.class!.starts_at).valueOf());

    const attended = past.filter((b) => b.status === 'attended').length;
    const noShow = past.filter((b) => b.status === 'no_show').length;
    const cancelled = past.filter((b) => b.status === 'cancelled').length;

    return {
      history: past,
      stats: {
        attended,
        noShow,
        cancelled,
        rate: attended + noShow > 0 ? Math.round((attended / (attended + noShow)) * 100) : null,
      },
    };
  }, [query.data]);

  const visible = useMemo(
    () => (filter === 'all' ? history : history.filter((b) => b.status === filter)),
    [history, filter],
  );

  return (
    <Screen>
      <View className="flex-row items-center px-3 py-2">
        <Pressable
          onPress={goBack}
          accessibilityLabel="뒤로"
          className="h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
          <Ionicons name="chevron-back" size={24} color="#2F3842" />
        </Pressable>
        <Text className="ml-1 flex-1 text-lg font-bold text-ink" numberOfLines={1}>
          지난 수업 이력{studio?.name ? ` · ${studio.name}` : ''}
        </Text>
      </View>

      {query.isLoading ? (
        <LoadingView />
      ) : query.isError ? (
        <ErrorView message={query.error.message} onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={BRAND} />}>
          {/* 출석 요약 */}
          <View className="mx-5 mt-2 flex-row rounded-2xl bg-surface px-2 py-4">
            <StatCell label="출석" value={`${stats.attended}`} />
            <StatCell label="노쇼" value={`${stats.noShow}`} tone={stats.noShow > 0 ? 'text-rose-600' : undefined} />
            <StatCell label="취소" value={`${stats.cancelled}`} />
            <StatCell label="출석률" value={stats.rate === null ? '-' : `${stats.rate}%`} />
          </View>

          {/* 필터 */}
          <View className="mt-4 flex-row gap-2 px-5">
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  className={`rounded-full px-3.5 py-2 ${active ? 'bg-ink' : 'bg-surface'}`}>
                  <Text className={`text-sm font-semibold ${active ? 'text-white' : 'text-stone-600'}`}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* 목록 */}
          <View className="mt-4">
            {visible.length === 0 ? (
              <EmptyView
                icon="time-outline"
                title={filter === 'all' ? '지난 수업 이력이 없습니다' : '해당하는 이력이 없습니다'}
                description={filter === 'all' ? '수업을 수강하거나 취소하면 이곳에 기록됩니다.' : undefined}
              />
            ) : (
              <View className="mx-5 rounded-2xl bg-surface px-4">
                {visible.map((booking, index) => (
                  <HistoryRow key={booking.id} booking={booking} first={index === 0} />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

function StatCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View className="flex-1 items-center">
      <Text className={`text-xl font-bold ${tone ?? 'text-ink'}`}>{value}</Text>
      <Text className="mt-0.5 text-xs text-stone-500">{label}</Text>
    </View>
  );
}

function HistoryRow({ booking, first }: { booking: MemberBooking; first: boolean }) {
  const cls = booking.class;
  if (!cls) return null;

  const unprocessed = booking.status === 'confirmed' && !dayjs(cls.starts_at).isAfter(dayjs());
  const tone = unprocessed ? { bg: 'bg-amber-50', text: 'text-amber-700' } : BOOKING_STATUS_TONE[booking.status];
  const label = unprocessed ? '출석 확인 중' : BOOKING_STATUS_LABEL[booking.status];

  const note =
    booking.status === 'cancelled'
      ? booking.pass_id === null
        ? '대기 중 취소 (차감 없음)'
        : booking.pass_refunded
          ? '수강권 횟수 복구됨'
          : '수강권 횟수 복구 없음'
      : booking.promoted_at
        ? '대기에서 자동 확정'
        : null;

  return (
    <View className={`flex-row items-center py-3.5 ${first ? '' : 'border-t border-stone-100'}`}>
      <View className="flex-1 pr-2">
        <Text className="text-sm font-semibold text-ink">
          {formatDay(cls.starts_at)} {formatTimeRange(cls.starts_at, cls.ends_at)}
        </Text>
        <Text className="mt-0.5 text-sm text-stone-500" numberOfLines={1}>
          {cls.title} · {classTypeLabel(cls.class_type, cls.max_capacity)}
        </Text>
        {note ? <Text className="mt-0.5 text-xs text-stone-400">{note}</Text> : null}
      </View>
      <Badge label={label} bg={tone.bg} text={tone.text} />
    </View>
  );
}
