import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { PassCard } from '@/components/PassCard';
import { BRAND, EmptyView, ErrorView, LoadingView, Screen } from '@/components/ui';
import { useMyPassDetail } from '@/hooks/queries';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { dayjs, formatDate } from '@/lib/date';
import { PASS_LOG_LABEL } from '@/lib/labels';
import type { PassLog } from '@/lib/types';

/** 회원 본인용 수강권 상세: 잔여 횟수·유효기간 + 차감/복구/연장 변동 내역 */
export default function MyPassDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const detailQuery = useMyPassDetail(id);
  const pull = usePullRefresh(detailQuery.refetch);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const data = detailQuery.data;

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
          {data?.pass.name ?? '수강권 내역'}
        </Text>
      </View>

      {detailQuery.isLoading ? (
        <LoadingView />
      ) : detailQuery.isError || !data ? (
        <ErrorView
          message={detailQuery.error?.message ?? '수강권을 불러오지 못했습니다.'}
          onRetry={() => void detailQuery.refetch()}
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={BRAND} />}>
          <View className="mt-1">
            <PassCard pass={data.pass} />
          </View>
          <Text className="mt-2 text-xs text-stone-400">
            총 {data.pass.total_count}회 · {formatDate(data.pass.starts_on)} ~ {formatDate(data.pass.expires_on)}
          </Text>

          <Text className="mb-2 mt-6 text-sm font-semibold text-stone-600">사용 · 변동 내역 {data.logs.length}건</Text>
          {data.logs.length === 0 ? (
            <EmptyView icon="receipt-outline" title="아직 변동 내역이 없습니다" />
          ) : (
            <View className="rounded-2xl bg-surface px-4">
              {data.logs.map((log, i) => (
                <LogRow key={log.id} log={log} first={i === 0} />
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

function LogRow({ log, first }: { log: Omit<PassLog, 'actor'>; first: boolean }) {
  const deltaText = log.delta === 0 ? '' : log.delta > 0 ? `+${log.delta}` : `${log.delta}`;
  return (
    <View className={`flex-row py-3.5 ${first ? '' : 'border-t border-stone-100'}`}>
      <View className="flex-1 pr-2">
        <Text className="text-sm font-semibold text-ink">{PASS_LOG_LABEL[log.reason]}</Text>
        {log.memo ? <Text className="mt-0.5 text-xs text-stone-500">{log.memo}</Text> : null}
        <Text className="mt-0.5 text-xs text-stone-400">{dayjs(log.created_at).format('YYYY.MM.DD HH:mm')}</Text>
      </View>
      <View className="items-end">
        {deltaText ? (
          <Text className={`text-base font-bold ${log.delta > 0 ? 'text-brand-700' : 'text-rose-600'}`}>{deltaText}</Text>
        ) : null}
        <Text className="text-xs text-stone-400">잔여 {log.remaining_after}회</Text>
      </View>
    </View>
  );
}
