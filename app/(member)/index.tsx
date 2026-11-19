import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { ClassCard } from '@/components/ClassCard';
import { NotificationBell } from '@/components/NotificationBell';
import { PassCard } from '@/components/PassCard';
import { BRAND, EmptyView, ErrorView, LoadingView, Screen, SectionTitle } from '@/components/ui';
import { useMyUpcomingClasses, usePasses } from '@/hooks/queries';
import { useStudio } from '@/hooks/useStudio';
import { useBookingActions } from '@/hooks/useBookingActions';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { dayjs, formatDay } from '@/lib/date';
import { isPassUsable } from '@/lib/passes';
import { useAuthStore } from '@/stores/auth';

const PASS_CARD_WIDTH = 264;
const PASS_CARD_GAP = 12;

export default function MemberHomeScreen() {
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const { studioId, studio } = useStudio();
  const passesQuery = usePasses(studioId, profile?.id);
  const upcomingQuery = useMyUpcomingClasses(studioId);
  const pull = usePullRefresh(passesQuery.refetch, upcomingQuery.refetch);
  const { requestBook, requestCancel, isBusy } = useBookingActions();

  // 쓸 수 있는 수강권을 앞에, 만료/소진된 수강권은 최근 30일 것만 뒤에 흐리게
  const passes = useMemo(() => {
    const all = passesQuery.data ?? [];
    const usable = all.filter(isPassUsable);
    const recentlyEnded = all.filter(
      (p) => !isPassUsable(p) && dayjs(p.expires_on).isAfter(dayjs().subtract(30, 'day')),
    );
    return [...usable, ...recentlyEnded];
  }, [passesQuery.data]);

  const upcoming = upcomingQuery.data ?? [];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={BRAND} />}>
        <View className="flex-row items-start px-5 pt-4">
          <View className="flex-1">
            <Text className="text-sm text-stone-500">
              {studio?.name} · {formatDay(dayjs())}
            </Text>
            <Text className="mt-1 text-2xl font-bold text-ink">{profile?.name || '회원'}님, 안녕하세요</Text>
          </View>
          <NotificationBell />
        </View>

        {/* ── 다중 수강권 카드: 잔여 횟수와 만료일을 홈 최상단에서 바로 확인 ── */}
        <SectionTitle
          title="내 수강권"
          right={
            passes.length > 0 ? (
              <Text className="text-xs text-stone-400">
                {passes.length > 1 ? `${passes.length}장 · 눌러서 내역 보기` : '눌러서 내역 보기'}
              </Text>
            ) : null
          }
        />
        {passesQuery.isLoading ? (
          <LoadingView />
        ) : passesQuery.isError ? (
          <ErrorView message={passesQuery.error.message} onRetry={() => void passesQuery.refetch()} />
        ) : passes.length === 0 ? (
          <EmptyView
            icon="ticket-outline"
            title="보유한 수강권이 없습니다"
            description="스튜디오에서 수강권을 등록하면 여기에 표시됩니다."
          />
        ) : (
          <FlatList
            horizontal
            data={passes}
            keyExtractor={(pass) => pass.id}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => router.push({ pathname: '/my-pass/[id]', params: { id: item.id } })}
                accessibilityRole="button"
                accessibilityLabel={`${item.name} 사용 내역 보기`}
                className="active:opacity-85">
                <PassCard pass={item} width={PASS_CARD_WIDTH} />
              </Pressable>
            )}
            ItemSeparatorComponent={() => <View style={{ width: PASS_CARD_GAP }} />}
            contentContainerStyle={{ paddingHorizontal: 20 }}
            showsHorizontalScrollIndicator={false}
            snapToInterval={PASS_CARD_WIDTH + PASS_CARD_GAP}
            decelerationRate="fast"
          />
        )}

        {/* ── 다가오는 예약 ── */}
        <SectionTitle
          title="다가오는 예약"
          right={
            <Pressable onPress={() => router.navigate('/schedule')} hitSlop={8}>
              <Text className="text-sm font-semibold text-brand-600">시간표 보기</Text>
            </Pressable>
          }
        />
        {upcomingQuery.isLoading ? (
          <LoadingView />
        ) : upcomingQuery.isError ? (
          <ErrorView message={upcomingQuery.error.message} onRetry={() => void upcomingQuery.refetch()} />
        ) : upcoming.length === 0 ? (
          <EmptyView
            icon="calendar-outline"
            title="예약된 수업이 없습니다"
            description="시간표에서 원하는 수업을 예약해 보세요."
          />
        ) : (
          <View className="gap-3 px-5">
            {upcoming.map((cls) => (
              <ClassCard
                key={cls.id}
                cls={cls}
                dateLabel={formatDay(cls.starts_at)}
                busy={isBusy(cls)}
                onBook={requestBook}
                onCancel={requestCancel}
              />
            ))}
          </View>
        )}

        {/* ── 지난 수업 이력 바로가기 ── */}
        <Pressable
          onPress={() => router.push('/my-history')}
          accessibilityRole="button"
          accessibilityLabel="지난 수업 이력 보기"
          className="mx-5 mt-5 flex-row items-center rounded-2xl bg-surface px-4 py-3.5 active:opacity-70">
          <Ionicons name="time-outline" size={18} color="#0B7A4D" />
          <Text className="ml-2.5 flex-1 text-sm font-semibold text-ink">지난 수업 · 출석 이력 보기</Text>
          <Ionicons name="chevron-forward" size={18} color="#A8A29E" />
        </Pressable>

        <Text className="mt-6 px-5 text-xs leading-5 text-stone-400">
          수업 시작 24시간 전까지 취소하면 수강권 횟수가 자동으로 복구됩니다. 24시간 이내 취소 또는 결석 시에는
          복구되지 않습니다.
        </Text>
      </ScrollView>
    </Screen>
  );
}
