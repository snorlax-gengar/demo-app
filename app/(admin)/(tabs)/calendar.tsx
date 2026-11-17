import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View, type ScrollViewInstance } from 'react-native';

import { BRAND, Badge, EmptyView, ErrorView, LoadingView, Screen } from '@/components/ui';
import { useClassRange } from '@/hooks/queries';
import { useStudio } from '@/hooks/useStudio';
import { dayjs, formatDay, formatTime, formatTimeRange, startOfWeek, weekDays, type Dayjs } from '@/lib/date';
import { classTypeLabel } from '@/lib/labels';
import type { ClassOverview } from '@/lib/types';
import { useAdminViewStore } from '@/stores/adminView';
import { useAuthStore } from '@/stores/auth';

type Mode = 'month' | 'day';

const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
const HOUR_HEIGHT = 64;
const DEFAULT_START_HOUR = 6;
const DEFAULT_END_HOUR = 24;
const GRID_LEFT = 52;

const dateKey = (d: Dayjs | string) => dayjs(d).format('YYYY-MM-DD');

export default function CalendarScreen() {
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const { studioId, isAdmin } = useStudio();
  const showAll = useAdminViewStore((s) => s.showAllInstructors);
  const setShowAll = useAdminViewStore((s) => s.setShowAllInstructors);
  // 강사는 항상 본인 수업만, 원장은 토글
  const viewingAll = isAdmin && showAll;
  const instructorId = viewingAll ? null : (profile?.id ?? null);

  const [mode, setMode] = useState<Mode>('month');
  const [selected, setSelected] = useState(() => dayjs().startOf('day'));
  const [month, setMonth] = useState(() => dayjs().startOf('month'));

  const gridStart = useMemo(() => startOfWeek(month), [month]);
  const weekStart = useMemo(() => startOfWeek(selected), [selected]);
  const rangeFrom = mode === 'month' ? gridStart : weekStart;
  const rangeTo = rangeFrom.add(mode === 'month' ? 42 : 7, 'day');
  const classesQuery = useClassRange(studioId, rangeFrom, rangeTo, instructorId);

  const byDay = useMemo(() => {
    const map: Record<string, ClassOverview[]> = {};
    for (const cls of classesQuery.data ?? []) (map[dateKey(cls.starts_at)] ??= []).push(cls);
    return map;
  }, [classesQuery.data]);
  const dayClasses = byDay[dateKey(selected)] ?? [];

  const selectDay = (d: Dayjs) => {
    const day = d.startOf('day');
    setSelected(day);
    if (!day.isSame(month, 'month')) setMonth(day.startOf('month'));
  };
  const goToday = () => selectDay(dayjs());
  const moveMonth = (offset: number) => {
    const next = month.add(offset, 'month');
    setMonth(next);
    setSelected(next.isSame(dayjs(), 'month') ? dayjs().startOf('day') : next);
  };

  const openClass = (id: string) => router.push({ pathname: '/(admin)/class/[id]', params: { id } });
  const createAt = (day: Dayjs, hour: number) =>
    router.push({ pathname: '/(admin)/class/new', params: { date: dateKey(day), hour: String(hour) } });
  const defaultHour = () => {
    if (!selected.isSame(dayjs(), 'day')) return 10;
    return Math.min(22, dayjs().hour() + 1);
  };
  /** 미래 날짜, 또는 아직 등록할 시간이 남은 오늘 */
  const canCreateOn = (day: Dayjs) =>
    day.isAfter(dayjs(), 'day') || (day.isSame(dayjs(), 'day') && dayjs().hour() < 23);

  const isToday = selected.isSame(dayjs(), 'day');
  const title = mode === 'month' ? month.format('YYYY년 M월') : formatDay(selected);

  return (
    <Screen>
      {/* ── 헤더 ── */}
      <View className="px-5 pt-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-bold text-ink">{title}</Text>
          <View className="flex-row items-center gap-2">
            {(mode === 'month' ? !month.isSame(dayjs(), 'month') : !isToday) ? (
              <Pressable onPress={goToday} className="rounded-full bg-brand-50 px-3 py-2 active:opacity-70">
                <Text className="text-sm font-semibold text-brand-700">오늘</Text>
              </Pressable>
            ) : null}
            <IconButton
              icon="chevron-back"
              label={mode === 'month' ? '이전 달' : '이전 날'}
              onPress={() => (mode === 'month' ? moveMonth(-1) : selectDay(selected.subtract(1, 'day')))}
            />
            <IconButton
              icon="chevron-forward"
              label={mode === 'month' ? '다음 달' : '다음 날'}
              onPress={() => (mode === 'month' ? moveMonth(1) : selectDay(selected.add(1, 'day')))}
            />
          </View>
        </View>

        <View className="mt-3 flex-row items-center justify-between">
          {/* 월간 / 일간 전환 */}
          <View className="flex-row rounded-full bg-stone-200 p-1">
            {(['month', 'day'] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === m }}
                className={`rounded-full px-4 py-1.5 ${mode === m ? 'bg-white' : ''}`}>
                <Text className={`text-sm font-semibold ${mode === m ? 'text-ink' : 'text-stone-500'}`}>
                  {m === 'month' ? '월간' : '일간 시간표'}
                </Text>
              </Pressable>
            ))}
          </View>
          {isAdmin ? (
            <Pressable
              onPress={() => setShowAll(!showAll)}
              accessibilityRole="switch"
              accessibilityState={{ checked: showAll }}
              className={`flex-row items-center rounded-full px-3 py-1.5 ${showAll ? 'bg-brand-600' : 'bg-white'}`}>
              <Ionicons name={showAll ? 'people' : 'person'} size={14} color={showAll ? '#FFFFFF' : '#57534E'} />
              <Text className={`ml-1 text-sm font-semibold ${showAll ? 'text-white' : 'text-stone-600'}`}>
                {showAll ? '전체 강사' : '내 수업'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {mode === 'day' ? <WeekStrip weekStart={weekStart} selected={selected} byDay={byDay} onSelect={selectDay} /> : null}
      </View>

      {classesQuery.isError ? (
        <View className="mt-6">
          <ErrorView message={classesQuery.error.message} onRetry={() => void classesQuery.refetch()} />
        </View>
      ) : mode === 'month' ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 96 }}
          refreshControl={
            <RefreshControl refreshing={classesQuery.isRefetching} onRefresh={() => void classesQuery.refetch()} tintColor={BRAND} />
          }>
          <MonthGrid gridStart={gridStart} month={month} selected={selected} byDay={byDay} onSelect={selectDay} />

          <View className="mt-5 flex-row items-center justify-between px-5">
            <Text className="text-base font-bold text-ink">
              {formatDay(selected)} · 수업 {dayClasses.length}개
            </Text>
            <Pressable onPress={() => setMode('day')} hitSlop={8} className="flex-row items-center">
              <Text className="text-sm font-semibold text-brand-600">시간표로 보기</Text>
              <Ionicons name="chevron-forward" size={14} color={BRAND} />
            </Pressable>
          </View>
          <View className="mt-3">
            {classesQuery.isLoading ? (
              <LoadingView />
            ) : dayClasses.length === 0 ? (
              <EmptyView
                icon="calendar-clear-outline"
                title="이 날은 수업이 없습니다"
                description={canCreateOn(selected) ? '오른쪽 아래 + 버튼으로 수업을 등록하세요.' : undefined}
              />
            ) : (
              <View className="gap-2 px-5">
                {dayClasses.map((cls) => (
                  <AgendaRow key={cls.id} cls={cls} showInstructor={viewingAll} onPress={() => openClass(cls.id)} />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      ) : classesQuery.isLoading ? (
        <LoadingView />
      ) : (
        <DayTimeGrid
          day={selected}
          classes={dayClasses}
          showInstructor={viewingAll}
          onPressClass={openClass}
          onPressHour={(hour) => createAt(selected, hour)}
          refreshing={classesQuery.isRefetching}
          onRefresh={() => void classesQuery.refetch()}
        />
      )}

      {/* 수업 등록 */}
      {canCreateOn(selected) ? (
        <Pressable
          onPress={() => createAt(selected, defaultHour())}
          accessibilityLabel="수업 등록"
          className="absolute bottom-5 right-5 h-14 w-14 items-center justify-center rounded-full bg-brand-600 active:opacity-80"
          style={{ shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 5 }}>
          <Ionicons name="add" size={30} color="#FFFFFF" />
        </Pressable>
      ) : null}
    </Screen>
  );
}

function IconButton({ icon, label, onPress }: { icon: 'chevron-back' | 'chevron-forward'; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      className="h-10 w-10 items-center justify-center rounded-full bg-white active:opacity-70">
      <Ionicons name={icon} size={20} color="#44403C" />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 월간 달력
// ---------------------------------------------------------------------------

function MonthGrid({
  gridStart,
  month,
  selected,
  byDay,
  onSelect,
}: {
  gridStart: Dayjs;
  month: Dayjs;
  selected: Dayjs;
  byDay: Record<string, ClassOverview[]>;
  onSelect: (d: Dayjs) => void;
}) {
  const today = dayjs();
  const days = Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'));
  // 마지막 줄이 전부 다음 달이면 숨겨 5줄 달력으로
  const visible = days[35].isSame(month, 'month') ? days : days.slice(0, 35);

  return (
    <View className="mx-3 mt-4 rounded-3xl bg-white px-1 pb-2 pt-3">
      <View className="flex-row">
        {WEEKDAY_LABELS.map((label, i) => (
          <Text
            key={label}
            className={`flex-1 text-center text-xs font-semibold ${i === 5 ? 'text-sky-600' : i === 6 ? 'text-rose-500' : 'text-stone-400'}`}>
            {label}
          </Text>
        ))}
      </View>
      <View className="mt-1 flex-row flex-wrap">
        {visible.map((day) => {
          const list = byDay[dateKey(day)] ?? [];
          const inMonth = day.isSame(month, 'month');
          const isSelected = day.isSame(selected, 'day');
          const isToday = day.isSame(today, 'day');
          const seats = list.reduce((sum, c) => sum + c.max_capacity, 0);
          const booked = list.reduce((sum, c) => sum + Math.min(c.confirmed_count, c.max_capacity), 0);
          const waiting = list.reduce((sum, c) => sum + c.waitlist_count, 0);
          const fill = seats > 0 ? booked / seats : 0;

          return (
            <Pressable
              key={day.valueOf()}
              onPress={() => onSelect(day)}
              accessibilityLabel={`${formatDay(day)} 수업 ${list.length}개`}
              style={{ width: `${100 / 7}%` }}
              className="items-center py-1.5">
              <View
                className={`h-8 w-8 items-center justify-center rounded-full ${
                  isSelected ? 'bg-brand-600' : isToday ? 'border border-brand-500' : ''
                }`}>
                <Text
                  className={`text-sm font-semibold ${
                    isSelected ? 'text-white' : !inMonth ? 'text-stone-300' : isToday ? 'text-brand-700' : 'text-ink'
                  }`}>
                  {day.date()}
                </Text>
              </View>
              {list.length > 0 ? (
                <>
                  <Text className={`mt-0.5 text-[10px] font-semibold ${inMonth ? 'text-stone-500' : 'text-stone-300'}`}>
                    {list.length}개
                  </Text>
                  {/* 예약률 막대 + 대기 점 */}
                  <View className="mt-0.5 flex-row items-center">
                    <View className="h-1 w-6 overflow-hidden rounded-full bg-stone-200">
                      <View
                        className={`h-full rounded-full ${fill >= 1 ? 'bg-rose-400' : 'bg-brand-400'}`}
                        style={{ width: `${Math.round(fill * 100)}%` }}
                      />
                    </View>
                    {waiting > 0 ? <View className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" /> : null}
                  </View>
                </>
              ) : (
                <View style={{ height: 19 }} />
              )}
            </Pressable>
          );
        })}
      </View>
      <View className="mt-1 flex-row items-center justify-end gap-3 px-3">
        <Legend color="bg-brand-400" label="예약률" />
        <Legend color="bg-rose-400" label="만석" />
        <Legend color="bg-amber-500" label="대기 있음" dot />
      </View>
    </View>
  );
}

function Legend({ color, label, dot }: { color: string; label: string; dot?: boolean }) {
  return (
    <View className="flex-row items-center">
      <View className={`${dot ? 'h-1.5 w-1.5' : 'h-1 w-3'} rounded-full ${color}`} />
      <Text className="ml-1 text-[10px] text-stone-400">{label}</Text>
    </View>
  );
}

function AgendaRow({ cls, showInstructor, onPress }: { cls: ClassOverview; showInstructor: boolean; onPress: () => void }) {
  const full = cls.confirmed_count >= cls.max_capacity;
  const isPrivate = cls.class_type === 'private';
  const past = !dayjs(cls.ends_at).isAfter(dayjs());

  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center rounded-2xl bg-white p-3.5 active:opacity-70 ${past ? 'opacity-60' : ''}`}>
      <View className={`mr-3 w-1 self-stretch rounded-full ${isPrivate ? 'bg-brand-700' : 'bg-brand-300'}`} />
      <View className="flex-1 pr-2">
        <Text className="text-base font-bold text-ink">{formatTimeRange(cls.starts_at, cls.ends_at)}</Text>
        <Text className="mt-0.5 text-sm text-stone-600" numberOfLines={1}>
          {cls.title}
          {showInstructor ? ` · ${cls.instructor_name}` : ''}
          {cls.location ? ` · ${cls.location}` : ''}
        </Text>
        <View className="mt-2 flex-row flex-wrap gap-1.5">
          <Badge
            label={classTypeLabel(cls.class_type, cls.max_capacity)}
            bg={isPrivate ? 'bg-brand-700' : 'bg-stone-100'}
            text={isPrivate ? 'text-white' : 'text-stone-600'}
          />
          <Badge
            label={`${cls.confirmed_count}/${cls.max_capacity}명`}
            bg={full ? 'bg-rose-50' : 'bg-brand-50'}
            text={full ? 'text-rose-700' : 'text-brand-700'}
          />
          {cls.waitlist_count > 0 ? <Badge label={`대기 ${cls.waitlist_count}명`} bg="bg-amber-50" text="text-amber-700" /> : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#A8A29E" />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 일간 시간표
// ---------------------------------------------------------------------------

function WeekStrip({
  weekStart,
  selected,
  byDay,
  onSelect,
}: {
  weekStart: Dayjs;
  selected: Dayjs;
  byDay: Record<string, ClassOverview[]>;
  onSelect: (d: Dayjs) => void;
}) {
  const today = dayjs();
  return (
    <View className="-mx-2 mt-3 flex-row">
      {weekDays(weekStart).map((day) => {
        const isSelected = day.isSame(selected, 'day');
        const count = (byDay[dateKey(day)] ?? []).length;
        return (
          <Pressable
            key={day.valueOf()}
            onPress={() => onSelect(day)}
            accessibilityLabel={`${formatDay(day)} 수업 ${count}개`}
            className={`mx-0.5 flex-1 items-center rounded-2xl py-2 ${isSelected ? 'bg-brand-600' : 'bg-white'}`}>
            <Text className={`text-xs ${isSelected ? 'text-brand-100' : day.isSame(today, 'day') ? 'text-brand-600' : 'text-stone-400'}`}>
              {day.format('dd')}
            </Text>
            <Text className={`text-base font-bold ${isSelected ? 'text-white' : 'text-ink'}`}>{day.date()}</Text>
            <Text className={`text-[10px] ${isSelected ? 'text-brand-100' : 'text-stone-400'}`}>{count > 0 ? `${count}개` : ' '}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface PlacedClass {
  cls: ClassOverview;
  col: number;
  cols: number;
}

/** 시간이 겹치는 수업(다른 강사)을 나란히 배치하기 위한 열 계산 */
function layoutColumns(classes: ClassOverview[]): PlacedClass[] {
  const sorted = [...classes].sort(
    (a, b) => a.starts_at.localeCompare(b.starts_at) || a.ends_at.localeCompare(b.ends_at),
  );
  const placed: PlacedClass[] = [];
  let cluster: { cls: ClassOverview; col: number }[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const item of cluster) placed.push({ ...item, cols: colEnds.length });
    cluster = [];
    colEnds = [];
    clusterEnd = -Infinity;
  };

  for (const cls of sorted) {
    const start = dayjs(cls.starts_at).valueOf();
    const end = dayjs(cls.ends_at).valueOf();
    if (cluster.length && start >= clusterEnd) flush();
    let col = colEnds.findIndex((e) => e <= start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(end);
    } else {
      colEnds[col] = end;
    }
    cluster.push({ cls, col });
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return placed;
}

function DayTimeGrid({
  day,
  classes,
  showInstructor,
  onPressClass,
  onPressHour,
  refreshing,
  onRefresh,
}: {
  day: Dayjs;
  classes: ClassOverview[];
  showInstructor: boolean;
  onPressClass: (id: string) => void;
  onPressHour: (hour: number) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const scrollRef = useRef<ScrollViewInstance>(null);
  const now = dayjs();
  const isToday = day.isSame(now, 'day');

  const startHour = Math.min(DEFAULT_START_HOUR, ...classes.map((c) => dayjs(c.starts_at).hour()));
  const endHour = DEFAULT_END_HOUR;
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const dayStart = day.startOf('day').add(startHour, 'hour');
  const toY = (iso: string | Dayjs) => (dayjs(iso).diff(dayStart, 'minute') / 60) * HOUR_HEIGHT;

  const placed = useMemo(() => layoutColumns(classes), [classes]);

  // 오늘이면 현재 시각, 아니면 첫 수업(없으면 9시) 근처로 스크롤
  const firstClass = classes[0]?.starts_at;
  useEffect(() => {
    const target = isToday ? dayjs().hour() - 1 : firstClass ? dayjs(firstClass).hour() - 1 : 9;
    const y = Math.max(0, (target - startHour) * HOUR_HEIGHT);
    const id = setTimeout(() => scrollRef.current?.scrollTo({ y, animated: false }), 0);
    return () => clearTimeout(id);
  }, [day.valueOf(), firstClass, isToday, startHour]);

  return (
    <ScrollView
      ref={scrollRef}
      className="mt-3"
      contentContainerStyle={{ paddingBottom: 96 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND} />}>
      <View style={{ height: hours.length * HOUR_HEIGHT + 8, marginTop: 8 }}>
        {/* 시간 줄 — 비어 있는 미래 시간을 누르면 그 시각으로 수업 등록 */}
        {hours.map((hour) => {
          const slotEnd = day.startOf('day').add(hour + 1, 'hour');
          const future = slotEnd.isAfter(now);
          return (
            <View key={hour} className="flex-row" style={{ height: HOUR_HEIGHT }}>
              <Text className="text-right text-[11px] text-stone-400" style={{ width: GRID_LEFT - 8, marginTop: -7 }}>
                {String(hour).padStart(2, '0')}:00
              </Text>
              <Pressable
                disabled={!future}
                onPress={() => onPressHour(hour)}
                accessibilityLabel={`${hour}시에 수업 등록`}
                className={`ml-2 mr-3 flex-1 border-t border-stone-200 ${future ? 'active:bg-brand-50' : 'bg-stone-100/60'}`}
              />
            </View>
          );
        })}

        {/* 수업 블록 */}
        <View
          pointerEvents="box-none"
          className="absolute bottom-0 top-0"
          style={{ left: GRID_LEFT + 2, right: 14 }}>
          {placed.map(({ cls, col, cols }) => {
            const top = toY(cls.starts_at);
            const height = Math.max(24, toY(cls.ends_at) - top - 2);
            const isPrivate = cls.class_type === 'private';
            const full = cls.confirmed_count >= cls.max_capacity;
            const past = !dayjs(cls.ends_at).isAfter(now);
            const compact = height < 44;
            return (
              <Pressable
                key={cls.id}
                onPress={() => onPressClass(cls.id)}
                accessibilityLabel={`${formatTime(cls.starts_at)} ${cls.title}`}
                style={{ position: 'absolute', top, height, left: `${(col / cols) * 100}%`, width: `${100 / cols}%`, paddingRight: 3 }}>
                <View
                  className={`flex-1 overflow-hidden rounded-xl px-2.5 py-1.5 ${
                    isPrivate ? 'bg-brand-700' : 'border-l-4 border-brand-500 bg-brand-50'
                  } ${past ? 'opacity-50' : ''}`}>
                  <Text className={`text-xs font-bold ${isPrivate ? 'text-white' : 'text-brand-900'}`} numberOfLines={1}>
                    {formatTime(cls.starts_at)} {cls.title}
                  </Text>
                  {!compact ? (
                    <>
                      <Text className={`mt-0.5 text-[11px] ${isPrivate ? 'text-brand-100' : 'text-brand-700'}`} numberOfLines={1}>
                        {showInstructor ? `${cls.instructor_name} · ` : ''}
                        {cls.confirmed_count}/{cls.max_capacity}명{full ? ' 만석' : ''}
                        {cls.waitlist_count > 0 ? ` · 대기 ${cls.waitlist_count}` : ''}
                      </Text>
                      {cls.location && cols === 1 ? (
                        <Text className={`text-[11px] ${isPrivate ? 'text-brand-200' : 'text-stone-500'}`} numberOfLines={1}>
                          {cls.location}
                        </Text>
                      ) : null}
                    </>
                  ) : null}
                </View>
              </Pressable>
            );
          })}

          {/* 현재 시각 */}
          {isToday && now.hour() >= startHour ? (
            <View
              pointerEvents="none"
              className="absolute flex-row items-center"
              style={{ top: toY(now) - 4, left: -6, right: 0 }}>
              <View className="h-2 w-2 rounded-full bg-rose-500" />
              <View className="h-px flex-1 bg-rose-500" />
            </View>
          ) : null}
        </View>
      </View>

      {classes.length === 0 ? (
        <Text className="mt-2 px-5 text-center text-sm text-stone-400">빈 시간을 누르면 그 시각으로 수업을 등록할 수 있습니다.</Text>
      ) : null}
    </ScrollView>
  );
}
