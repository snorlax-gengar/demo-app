import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { ClassCard } from '@/components/ClassCard';
import { BRAND, EmptyView, ErrorView, LoadingView, Screen } from '@/components/ui';
import { useWeekClasses } from '@/hooks/queries';
import { useStudio } from '@/hooks/useStudio';
import { useBookingActions } from '@/hooks/useBookingActions';
import { dayjs, formatDay, startOfWeek, weekDays } from '@/lib/date';
import type { ClassOverview, ClassType } from '@/lib/types';

type TypeFilter = 'all' | ClassType;

const TYPE_FILTERS: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'private', label: '1:1 개인' },
  { key: 'group', label: '그룹' },
];

export default function MemberScheduleScreen() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(dayjs()));
  const [selectedDay, setSelectedDay] = useState(() => dayjs().startOf('day'));
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const { studioId } = useStudio();
  const classesQuery = useWeekClasses(studioId, weekStart);
  const { requestBook, requestCancel, isBusy } = useBookingActions();

  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const today = dayjs().startOf('day');
  const isCurrentWeek = weekStart.isSame(startOfWeek(dayjs()), 'day');

  // 요일별로 묶기: { 'YYYY-MM-DD': ClassOverview[] }
  const classesByDay = useMemo(() => {
    const map: Record<string, ClassOverview[]> = {};
    for (const cls of classesQuery.data ?? []) {
      const key = dayjs(cls.starts_at).format('YYYY-MM-DD');
      (map[key] ??= []).push(cls);
    }
    return map;
  }, [classesQuery.data]);

  const dayClasses = useMemo(() => {
    const list = classesByDay[selectedDay.format('YYYY-MM-DD')] ?? [];
    return typeFilter === 'all' ? list : list.filter((cls) => cls.class_type === typeFilter);
  }, [classesByDay, selectedDay, typeFilter]);

  const moveWeek = (offset: number) => {
    const next = weekStart.add(offset * 7, 'day');
    setWeekStart(next);
    // 이번 주로 돌아오면 오늘, 다른 주는 같은 요일을 선택
    const sameWeekday = next.add(selectedDay.diff(weekStart, 'day'), 'day');
    setSelectedDay(next.isSame(startOfWeek(dayjs()), 'day') ? dayjs().startOf('day') : sameWeekday);
  };

  const goToday = () => {
    setWeekStart(startOfWeek(dayjs()));
    setSelectedDay(dayjs().startOf('day'));
  };

  return (
    <Screen>
      {/* ── 주 이동 ── */}
      <View className="flex-row items-center justify-between px-5 pt-4">
        <View>
          <Text className="text-2xl font-bold text-ink">시간표</Text>
          <Text className="mt-0.5 text-sm text-stone-500">
            {weekStart.format('M월 D일')} – {weekStart.add(6, 'day').format('M월 D일')}
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          {!isCurrentWeek ? (
            <Pressable onPress={goToday} className="rounded-full bg-brand-50 px-3 py-2 active:opacity-70">
              <Text className="text-sm font-semibold text-brand-700">이번 주</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => moveWeek(-1)}
            accessibilityLabel="이전 주"
            className="h-10 w-10 items-center justify-center rounded-full bg-white active:opacity-70">
            <Ionicons name="chevron-back" size={20} color="#44403C" />
          </Pressable>
          <Pressable
            onPress={() => moveWeek(1)}
            accessibilityLabel="다음 주"
            className="h-10 w-10 items-center justify-center rounded-full bg-white active:opacity-70">
            <Ionicons name="chevron-forward" size={20} color="#44403C" />
          </Pressable>
        </View>
      </View>

      {/* ── 요일 선택 (월~일) ── */}
      <View className="mt-4 flex-row px-3">
        {days.map((day) => {
          const key = day.format('YYYY-MM-DD');
          const selected = day.isSame(selectedDay, 'day');
          const isToday = day.isSame(today, 'day');
          const list = classesByDay[key] ?? [];
          const hasMine = list.some((cls) => cls.my_booking_status !== null);
          return (
            <Pressable
              key={key}
              onPress={() => setSelectedDay(day)}
              accessibilityLabel={formatDay(day)}
              className={`mx-1 flex-1 items-center rounded-2xl py-2.5 ${selected ? 'bg-brand-600' : 'bg-white'}`}>
              <Text className={`text-xs ${selected ? 'text-brand-100' : isToday ? 'text-brand-600' : 'text-stone-400'}`}>
                {day.format('dd')}
              </Text>
              <Text className={`mt-0.5 text-base font-bold ${selected ? 'text-white' : 'text-ink'}`}>
                {day.format('D')}
              </Text>
              {/* 점: 내 예약이 있는 날은 진하게, 수업만 있는 날은 연하게 */}
              <View
                className={`mt-1 h-1.5 w-1.5 rounded-full ${
                  hasMine ? (selected ? 'bg-white' : 'bg-brand-500') : list.length > 0 ? (selected ? 'bg-brand-400' : 'bg-stone-300') : 'bg-transparent'
                }`}
              />
            </Pressable>
          );
        })}
      </View>

      {/* ── 수업 유형 필터 ── */}
      <View className="mt-4 flex-row gap-2 px-5">
        {TYPE_FILTERS.map((filter) => {
          const active = typeFilter === filter.key;
          return (
            <Pressable
              key={filter.key}
              onPress={() => setTypeFilter(filter.key)}
              className={`rounded-full px-4 py-2 ${active ? 'bg-ink' : 'bg-white'}`}>
              <Text className={`text-sm font-semibold ${active ? 'text-white' : 'text-stone-500'}`}>{filter.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* ── 선택한 날의 수업 ── */}
      {classesQuery.isLoading ? (
        <LoadingView />
      ) : classesQuery.isError ? (
        <View className="mt-6">
          <ErrorView message={classesQuery.error.message} onRetry={() => void classesQuery.refetch()} />
        </View>
      ) : (
        <FlatList
          data={dayClasses}
          keyExtractor={(cls) => cls.id}
          renderItem={({ item }) => (
            <ClassCard cls={item} busy={isBusy(item)} onBook={requestBook} onCancel={requestCancel} />
          )}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }}
          ListHeaderComponent={
            <Text className="mb-3 text-sm font-semibold text-stone-500">
              {formatDay(selectedDay)} · 수업 {dayClasses.length}개
            </Text>
          }
          ListEmptyComponent={
            <View style={{ marginHorizontal: -20 }}>
              <EmptyView icon="moon-outline" title="이 날은 수업이 없습니다" description="다른 요일을 선택해 보세요." />
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={classesQuery.isRefetching}
              onRefresh={() => void classesQuery.refetch()}
              tintColor={BRAND}
            />
          }
        />
      )}
    </Screen>
  );
}
