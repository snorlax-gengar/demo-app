import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';

import { BRAND, EmptyView, ErrorView, LoadingView, Screen } from '@/components/ui';
import { useMembers } from '@/hooks/queries';
import { useStudio } from '@/hooks/useStudio';
import { ROLE_LABEL } from '@/lib/labels';
import { EXPIRING_DAYS, LOW_REMAINING, dDayLabel, summarizePasses, type PassSummary } from '@/lib/passes';
import type { ClassType, MemberWithPasses } from '@/lib/types';

type Filter = 'all' | 'low' | 'expiring' | 'none' | 'staff';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '회원' },
  { key: 'low', label: `잔여 ${LOW_REMAINING}회 이하` },
  { key: 'expiring', label: `${EXPIRING_DAYS}일 내 만료` },
  { key: 'none', label: '수강권 없음' },
  { key: 'staff', label: '직원' },
];

/** 수강권 필터는 회원(role=member)에게만, '직원'은 원장·관리자·강사 */
const matches = (filter: Filter, row: Row) => {
  const isMember = row.member.role === 'member';
  if (filter === 'staff') return !isMember;
  if (!isMember) return false;
  const s = row.summary;
  return filter === 'all' ? true : filter === 'low' ? s.low : filter === 'expiring' ? s.expiring : !s.hasUsable;
};

interface Row {
  member: MemberWithPasses;
  summary: PassSummary;
}

/** 회원 목록: 이름 옆에 유형별 잔여 횟수와 만료일. 재등록 대상만 골라 볼 수 있다 */
export default function MembersScreen() {
  const router = useRouter();
  const { studioId } = useStudio();
  const membersQuery = useMembers(studioId);
  const [keyword, setKeyword] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo<Row[]>(
    () => (membersQuery.data ?? []).map((member) => ({ member, summary: summarizePasses(member.passes) })),
    [membersQuery.data],
  );

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, low: 0, expiring: 0, none: 0, staff: 0 };
    for (const r of rows) for (const f of FILTERS) if (matches(f.key, r)) c[f.key] += 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    const list = rows.filter((row) => {
      const m = row.member;
      if (!matches(filter, row)) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        (m.email ?? '').toLowerCase().includes(q) ||
        (digits.length > 0 && (m.phone ?? '').replace(/\D/g, '').includes(digits))
      );
    });
    // 필터 화면에서는 급한 순으로
    if (filter === 'low') list.sort((a, b) => (a.summary.minRemaining ?? 0) - (b.summary.minRemaining ?? 0));
    if (filter === 'expiring') list.sort((a, b) => (a.summary.minDaysLeft ?? 0) - (b.summary.minDaysLeft ?? 0));
    return list;
  }, [rows, filter, keyword]);

  return (
    <Screen>
      <View className="px-5 pt-4">
        <Text className="text-2xl font-bold text-ink">회원</Text>
        <View className="mt-4 flex-row items-center rounded-2xl bg-white px-4">
          <Ionicons name="search" size={18} color="#A8A29E" />
          <TextInput
            value={keyword}
            onChangeText={setKeyword}
            placeholder="이름, 연락처, 이메일 검색"
            placeholderTextColor="#A8A29E"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            className="ml-2 flex-1 py-3.5 text-base text-ink"
          />
        </View>
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, gap: 8 }}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const alert = f.key !== 'all' && f.key !== 'staff' && counts[f.key] > 0;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                className={`flex-row items-center rounded-full px-3.5 py-2 ${active ? 'bg-ink' : 'bg-white'}`}>
                <Text className={`text-sm font-semibold ${active ? 'text-white' : 'text-stone-600'}`}>{f.label}</Text>
                <Text
                  className={`ml-1.5 text-sm font-bold ${active ? 'text-brand-200' : alert ? 'text-amber-600' : 'text-stone-400'}`}>
                  {counts[f.key]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {membersQuery.isLoading ? (
        <LoadingView />
      ) : membersQuery.isError ? (
        <View className="mt-6">
          <ErrorView message={membersQuery.error.message} onRetry={() => void membersQuery.refetch()} />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(row) => row.member.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 32 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={
            <View style={{ marginHorizontal: -20 }}>
              <EmptyView
                icon="people-outline"
                title={keyword ? '검색 결과가 없습니다' : filter === 'all' ? '등록된 회원이 없습니다' : '해당하는 회원이 없습니다'}
              />
            </View>
          }
          refreshControl={
            <RefreshControl refreshing={membersQuery.isRefetching} onRefresh={() => void membersQuery.refetch()} tintColor={BRAND} />
          }
          renderItem={({ item }) => (
            <MemberRow
              row={item}
              onPress={() => router.push({ pathname: '/(admin)/member/[id]', params: { id: item.member.id } })}
            />
          )}
        />
      )}
    </Screen>
  );
}

function MemberRow({ row, onPress }: { row: Row; onPress: () => void }) {
  const { member, summary } = row;
  return (
    <Pressable onPress={onPress} className="flex-row items-center rounded-2xl bg-white px-4 py-3.5 active:opacity-70">
      <View className="h-11 w-11 items-center justify-center rounded-full bg-brand-100">
        <Text className="text-base font-bold text-brand-700">{member.name.slice(0, 1) || '?'}</Text>
      </View>
      <View className="ml-3 flex-1">
        <View className="flex-row items-baseline">
          <Text className="shrink text-base font-semibold text-ink" numberOfLines={1}>
            {member.name || '이름 없음'}
          </Text>
          <Text className="ml-2 text-xs text-stone-400" numberOfLines={1}>
            {member.phone || member.email || ''}
          </Text>
        </View>
        <View className="mt-1.5 flex-row flex-wrap gap-1.5">
          {member.role !== 'member' ? (
            <View className="rounded-lg bg-ink px-2 py-1">
              <Text className="text-xs font-semibold text-white">{ROLE_LABEL[member.role]}</Text>
            </View>
          ) : summary.hasUsable ? (
            (['private', 'group'] as ClassType[]).map((type) => {
              const s = summary.byType[type];
              if (!s) return null;
              const warn = s.remaining <= LOW_REMAINING || s.daysLeft <= EXPIRING_DAYS;
              return (
                <View key={type} className={`flex-row items-center rounded-lg px-2 py-1 ${warn ? 'bg-amber-50' : 'bg-brand-50'}`}>
                  <Text className={`text-xs font-semibold ${warn ? 'text-amber-700' : 'text-brand-700'}`}>
                    {type === 'private' ? '1:1' : '그룹'} {s.remaining}회
                  </Text>
                  <Text className={`ml-1 text-xs ${warn ? 'text-amber-600' : 'text-stone-400'}`}>· {dDayLabel(s.daysLeft)}</Text>
                </View>
              );
            })
          ) : (
            <View className="rounded-lg bg-stone-100 px-2 py-1">
              <Text className="text-xs font-semibold text-stone-500">사용 가능한 수강권 없음</Text>
            </View>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#A8A29E" />
    </Pressable>
  );
}
