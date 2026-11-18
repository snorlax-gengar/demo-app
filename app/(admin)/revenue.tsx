import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { BRAND, EmptyView, ErrorView, LoadingView, Screen } from '@/components/ui';
import { useRevenue } from '@/hooks/queries';
import { useStudio } from '@/hooks/useStudio';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { dayjs } from '@/lib/date';
import { PAYMENT_METHOD_LABEL, formatWon } from '@/lib/labels';
import { shortWon, summarizeRevenue } from '@/lib/revenue';

const TYPE_LABEL = { group: '그룹', private: '1:1 개인' } as const;
const METHOD_COLOR = { card: '#0B7A4D', transfer: '#53FAA6', cash: '#A7F3D0', other: '#D6D3CC' } as const;

/** 원장 전용 매출: 월별 결제 합계·지난달 대비·결제 수단/수강권 유형별·일별 추이·결제 목록 */
export default function RevenueScreen() {
  const router = useRouter();
  const { studioId, studio, isOwner } = useStudio();
  const [month, setMonth] = useState(() => dayjs().startOf('month'));
  const query = useRevenue(studioId, month, isOwner);
  const pull = usePullRefresh(query.refetch);
  const isCurrentMonth = month.isSame(dayjs(), 'month');

  const summary = useMemo(
    () => (query.data ? summarizeRevenue(query.data.rows, month, query.data.prevTotal) : null),
    [query.data, month],
  );

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/profile'));

  const header = (
    <View className="flex-row items-center px-3 py-2">
      <Pressable onPress={goBack} accessibilityLabel="뒤로" className="h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
        <Ionicons name="chevron-back" size={24} color="#2F3842" />
      </Pressable>
      <Text className="ml-1 flex-1 text-lg font-bold text-ink" numberOfLines={1}>
        매출 · {studio?.name}
      </Text>
    </View>
  );

  if (!isOwner) {
    return (
      <Screen>
        {header}
        <EmptyView icon="lock-closed-outline" title="원장만 볼 수 있습니다" description="매출 정보는 스튜디오 원장에게만 보입니다." />
      </Screen>
    );
  }

  const body = () => {
    if (query.isLoading) return <LoadingView />;
    if (query.isError || !summary || !query.data) {
      return <ErrorView message={query.error?.message ?? '매출을 불러오지 못했습니다.'} onRetry={() => void query.refetch()} />;
    }
    const { rows, unpaidIssued } = query.data;
    const maxDay = Math.max(1, ...summary.byDay.map((d) => d.amount));
    const change = summary.changePct;

    return (
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={BRAND} />}>
        {/* 합계 */}
        <View className="mt-2 rounded-3xl bg-brand-700 p-5">
          <Text className="text-sm font-semibold text-brand-100">{month.format('YYYY년 M월')} 결제 합계</Text>
          <Text accessibilityLabel="결제 합계" className="mt-1 text-3xl font-bold text-white">
            {formatWon(summary.total)}
          </Text>
          <View className="mt-2 flex-row items-center">
            {change === null ? (
              <Text className="text-xs text-brand-100">지난달 결제 없음</Text>
            ) : (
              <View className="flex-row items-center rounded-full bg-white/15 px-2 py-0.5">
                <Ionicons name={change >= 0 ? 'arrow-up' : 'arrow-down'} size={12} color="#FFFFFF" />
                <Text className="ml-0.5 text-xs font-semibold text-white">
                  지난달보다 {Math.abs(change)}% {change >= 0 ? '증가' : '감소'}
                </Text>
              </View>
            )}
            {isCurrentMonth ? <Text className="ml-2 text-xs text-brand-100">오늘까지</Text> : null}
          </View>
          <View className="mt-4 flex-row border-t border-white/15 pt-3">
            <View className="flex-1">
              <Text className="text-xs text-brand-100">결제 건수</Text>
              <Text className="mt-0.5 text-base font-bold text-white">{summary.count}건</Text>
            </View>
            <View className="flex-1">
              <Text className="text-xs text-brand-100">건당 평균</Text>
              <Text className="mt-0.5 text-base font-bold text-white">{formatWon(summary.average)}</Text>
            </View>
          </View>
        </View>

        {unpaidIssued > 0 ? (
          <View className="mt-3 flex-row items-start rounded-2xl bg-amber-50 px-4 py-3">
            <Ionicons name="information-circle-outline" size={18} color="#B45309" />
            <Text className="ml-2 flex-1 text-xs leading-5 text-amber-800">
              이 달에 결제 금액 없이 발급한 수강권이 {unpaidIssued}장 있습니다. 금액을 넣어 발급해야 매출에 잡힙니다.
            </Text>
          </View>
        ) : null}

        {summary.count === 0 ? (
          <View className="mt-4">
            <EmptyView icon="receipt-outline" title="이 달 결제 기록이 없습니다" description="수강권을 발급할 때 결제 금액을 입력하면 여기에 쌓입니다." />
          </View>
        ) : (
          <>
            {/* 일별 추이 */}
            <Text className="mb-2 mt-6 text-sm font-semibold text-stone-600">일별 결제</Text>
            <View className="rounded-2xl bg-surface px-4 pb-3 pt-4">
              <Text className="mb-1 text-[11px] text-stone-400">최고 {shortWon(maxDay)}원</Text>
              <View accessibilityLabel="일별 결제 막대 그래프" className="h-24 flex-row items-end">
                {summary.byDay.map((d) => (
                  <View key={d.day} className="flex-1 items-center justify-end px-[1px]" style={{ height: '100%' }}>
                    <View
                      className={`w-full rounded-t-sm ${d.amount > 0 ? 'bg-brand-500' : 'bg-stone-100'}`}
                      style={{ height: d.amount > 0 ? `${Math.max(6, (d.amount / maxDay) * 100)}%` : 2 }}
                    />
                  </View>
                ))}
              </View>
              <View className="mt-1 flex-row justify-between">
                {[1, 8, 15, 22, summary.byDay.length].map((day) => (
                  <Text key={day} className="text-[10px] text-stone-400">
                    {day}일
                  </Text>
                ))}
              </View>
            </View>

            {/* 결제 수단 · 수강권 유형 */}
            <Text className="mb-2 mt-6 text-sm font-semibold text-stone-600">결제 수단</Text>
            <View className="rounded-2xl bg-surface p-4">
              <View className="h-3 flex-row overflow-hidden rounded-full bg-stone-100">
                {summary.byMethod.map((m) => (
                  <View key={m.method} style={{ flex: m.amount || 0.0001, backgroundColor: METHOD_COLOR[m.method] }} />
                ))}
              </View>
              {summary.byMethod.map((m) => (
                <View key={m.method} className="mt-3 flex-row items-center">
                  <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: METHOD_COLOR[m.method] }} />
                  <Text className="ml-2 flex-1 text-sm text-ink">
                    {PAYMENT_METHOD_LABEL[m.method]} <Text className="text-stone-400">{m.count}건</Text>
                  </Text>
                  <Text className="text-sm font-semibold text-ink">{formatWon(m.amount)}</Text>
                  <Text className="ml-2 w-10 text-right text-xs text-stone-400">{Math.round((m.amount / summary.total) * 100)}%</Text>
                </View>
              ))}
            </View>

            <Text className="mb-2 mt-6 text-sm font-semibold text-stone-600">수강권 유형</Text>
            <View className="rounded-2xl bg-surface px-4">
              {summary.byType.map((t, i) => (
                <View key={t.type} className={`flex-row items-center py-3.5 ${i ? 'border-t border-stone-100' : ''}`}>
                  <Text className="flex-1 text-sm text-ink">
                    {TYPE_LABEL[t.type]} <Text className="text-stone-400">{t.count}건</Text>
                  </Text>
                  <Text className="text-sm font-semibold text-ink">{formatWon(t.amount)}</Text>
                </View>
              ))}
            </View>

            {/* 결제 목록 */}
            <Text className="mb-2 mt-6 text-sm font-semibold text-stone-600">결제 내역 {rows.length}건</Text>
            <View className="rounded-2xl bg-surface px-4">
              {rows.map((r, i) => (
                <Pressable
                  key={r.id}
                  disabled={!r.pass}
                  onPress={() => r.pass && router.push({ pathname: '/(admin)/pass/[id]', params: { id: r.pass.id } })}
                  className={`flex-row items-center py-3 active:opacity-60 ${i ? 'border-t border-stone-100' : ''}`}>
                  <View className="flex-1 pr-2">
                    <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
                      {r.member?.name ?? '탈퇴 회원'} · {r.pass?.name ?? '-'}
                    </Text>
                    <Text className="mt-0.5 text-xs text-stone-400">
                      {dayjs(r.paid_on).format('M월 D일 (dd)')} · {PAYMENT_METHOD_LABEL[r.method]}
                      {r.memo ? ` · ${r.memo}` : ''}
                    </Text>
                  </View>
                  <Text className="text-sm font-bold text-ink">{formatWon(r.amount)}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    );
  };

  return (
    <Screen>
      {header}
      <View className="mx-5 mb-2 flex-row items-center justify-between">
        <Pressable
          onPress={() => setMonth((m) => m.subtract(1, 'month'))}
          accessibilityLabel="이전 달"
          className="h-10 w-10 items-center justify-center rounded-full bg-surface active:opacity-70">
          <Ionicons name="chevron-back" size={20} color="#2F3842" />
        </Pressable>
        <Text className="text-base font-bold text-ink">{month.format('YYYY년 M월')}</Text>
        <Pressable
          onPress={() => setMonth((m) => m.add(1, 'month'))}
          disabled={isCurrentMonth}
          accessibilityLabel="다음 달"
          className={`h-10 w-10 items-center justify-center rounded-full bg-surface active:opacity-70 ${isCurrentMonth ? 'opacity-30' : ''}`}>
          <Ionicons name="chevron-forward" size={20} color="#2F3842" />
        </Pressable>
      </View>
      {body()}
    </Screen>
  );
}
