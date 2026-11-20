import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';

import { EmptyView, ErrorView, LoadingView, Screen } from '@/components/ui';
import { useTrialRequests, useUpdateTrialRequest } from '@/hooks/queries';
import { usePullRefresh } from '@/hooks/usePullRefresh';
import { useStudio } from '@/hooks/useStudio';
import { dayjs } from '@/lib/date';
import { showDialog } from '@/lib/dialog';
import { TRIAL_STATUS_LABEL, formatPhone, type TrialRequest, type TrialStatus } from '@/lib/studioPage';

type Tab = 'open' | 'closed';
const OPEN: TrialStatus[] = ['new', 'contacted', 'scheduled'];
const NEXT: TrialStatus[] = ['contacted', 'scheduled', 'done', 'declined'];

/** 소개 페이지로 들어온 체험 수업 신청 (원장·실장). 신청 기록은 180일 뒤 자동 삭제 */
export default function TrialsScreen() {
  const router = useRouter();
  const { studioId, isAdmin } = useStudio();
  const query = useTrialRequests(studioId, isAdmin);
  const pull = usePullRefresh(query.refetch);
  const [tab, setTab] = useState<Tab>('open');
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/profile'));

  const header = (
    <View className="flex-row items-center px-3 py-2">
      <Pressable onPress={goBack} accessibilityLabel="뒤로" className="h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
        <Ionicons name="chevron-back" size={24} color="#2F3842" />
      </Pressable>
      <Text className="ml-1 flex-1 text-lg font-bold text-ink">체험 신청</Text>
      <Pressable onPress={() => router.push('/(admin)/studio-page')} accessibilityRole="link" className="rounded-full px-3 py-2 active:bg-stone-200">
        <Text className="text-sm font-semibold text-brand-700">소개 페이지</Text>
      </Pressable>
    </View>
  );

  if (!isAdmin) {
    return (
      <Screen>
        {header}
        <ErrorView message="원장·실장만 볼 수 있습니다." onRetry={goBack} />
      </Screen>
    );
  }

  const all = query.data ?? [];
  const openList = all.filter((r) => OPEN.includes(r.status));
  const closedList = all.filter((r) => !OPEN.includes(r.status));
  const list = tab === 'open' ? openList : closedList;

  return (
    <Screen>
      {header}
      <View className="mx-5 mb-2 flex-row rounded-full bg-stone-200 p-1">
        {(
          [
            ['open', `진행 중 ${openList.length}`],
            ['closed', `끝남 ${closedList.length}`],
          ] as const
        ).map(([key, label]) => (
          <Pressable key={key} onPress={() => setTab(key)} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} className={`flex-1 items-center rounded-full py-2 ${tab === key ? 'bg-white' : ''}`}>
            <Text className={`text-sm font-semibold ${tab === key ? 'text-ink' : 'text-stone-500'}`}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {query.isLoading ? (
        <LoadingView />
      ) : query.isError ? (
        <ErrorView message={query.error.message} onRetry={() => void query.refetch()} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }} refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}>
          {list.length === 0 ? (
            <EmptyView
              icon="sparkles-outline"
              title={tab === 'open' ? '진행 중인 체험 신청이 없어요' : '끝난 신청이 없어요'}
              description="소개 페이지 링크를 공유하면 이곳으로 체험 신청이 들어와요."
            />
          ) : (
            list.map((r) => <TrialCard key={r.id} req={r} studioId={studioId} />)
          )}
          <Text className="mt-4 text-center text-xs text-stone-400">신청자 정보는 체험 안내 목적으로만 쓰고, 신청 후 180일이 지나면 자동으로 지워져요.</Text>
        </ScrollView>
      )}
    </Screen>
  );
}

function TrialCard({ req, studioId }: { req: TrialRequest; studioId: string }) {
  const update = useUpdateTrialRequest();
  const [memo, setMemo] = useState(req.memo ?? '');
  const memoChanged = memo.trim() !== (req.memo ?? '');
  const phone = formatPhone(req.phone);

  const setStatus = (status: TrialStatus) =>
    update.mutate({ studioId, id: req.id, status, memo: memoChanged ? memo : null }, { onError: (e) => showDialog('바꾸지 못했어요', e.message) });

  return (
    <View accessibilityLabel={`체험 신청 ${req.name}`} className="mt-3 rounded-3xl bg-surface p-5">
      <View className="flex-row items-center">
        <Text className="flex-1 text-lg font-bold text-ink">{req.name}</Text>
        <View className={`rounded-full px-2.5 py-1 ${req.status === 'new' ? 'bg-brand-600' : 'bg-stone-200'}`}>
          <Text className={`text-xs font-bold ${req.status === 'new' ? 'text-white' : 'text-stone-600'}`}>{TRIAL_STATUS_LABEL[req.status]}</Text>
        </View>
      </View>
      <Text className="mt-0.5 text-xs text-stone-500">{dayjs(req.created_at).format('M월 D일 HH:mm')} 신청</Text>
      {req.preferred ? <Text className="mt-2 text-sm text-stone-700">희망: {req.preferred}</Text> : null}
      {req.message ? <Text className="mt-1 text-sm leading-5 text-stone-700">"{req.message}"</Text> : null}

      <View className="mt-3 flex-row gap-2">
        <Pressable onPress={() => void Linking.openURL(`tel:${req.phone}`)} accessibilityRole="button" accessibilityLabel={`${req.name}에게 전화`} className="flex-1 flex-row items-center justify-center rounded-2xl bg-white py-3 active:opacity-70">
          <Ionicons name="call-outline" size={16} color="#0B6E46" />
          <Text className="ml-1.5 text-sm font-bold text-brand-700">{phone}</Text>
        </Pressable>
        <Pressable onPress={() => void Linking.openURL(`sms:${req.phone}`)} accessibilityRole="button" accessibilityLabel={`${req.name}에게 문자`} className="flex-row items-center justify-center rounded-2xl bg-white px-4 py-3 active:opacity-70">
          <Ionicons name="chatbubble-outline" size={16} color="#0B6E46" />
          <Text className="ml-1.5 text-sm font-bold text-brand-700">문자</Text>
        </Pressable>
      </View>

      <View className="mt-3 flex-row flex-wrap gap-2">
        {NEXT.map((s) => (
          <Pressable
            key={s}
            onPress={() => setStatus(s)}
            disabled={update.isPending || (req.status === s && !memoChanged)}
            accessibilityRole="radio"
            accessibilityState={{ selected: req.status === s }}
            className={`rounded-full px-3 py-1.5 ${req.status === s ? 'bg-ink' : 'bg-white'}`}>
            <Text className={`text-sm font-semibold ${req.status === s ? 'text-white' : 'text-stone-600'}`}>{TRIAL_STATUS_LABEL[s]}</Text>
          </Pressable>
        ))}
      </View>

      <View className="mt-3 flex-row items-center rounded-2xl border border-stone-200 bg-white pl-4">
        <TextInput value={memo} onChangeText={setMemo} maxLength={500} placeholder="메모 (예: 토 10시 체험 안내함)" placeholderTextColor="#A8A29E" accessibilityLabel={`${req.name} 메모`} className="flex-1 py-3 text-[15px] text-ink" />
        {memoChanged ? (
          <Pressable onPress={() => setStatus(req.status)} disabled={update.isPending} accessibilityRole="button" accessibilityLabel={`${req.name} 메모 저장`} className="px-4 py-3">
            <Text className="text-sm font-bold text-brand-700">저장</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
