import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { ErrorView, LoadingView, Screen } from '@/components/ui';
import { useCloseStudio, useCloseStudioPreview } from '@/hooks/queries';
import { showDialog } from '@/lib/dialog';
import { useStudio } from '@/hooks/useStudio';
import { useAuthStore } from '@/stores/auth';

/**
 * 스튜디오 운영 종료 (원장만). 앞으로의 수업 폐강·수강권 복구 → 남은 사람에게 종료 알림 → 모두 탈퇴 처리.
 * 예약·출석·결제 기록은 남는다. 되돌릴 수 없으므로 스튜디오 이름을 그대로 입력해야 진행된다.
 */
export default function CloseStudioScreen() {
  const router = useRouter();
  const { studioId, studio, isOwner } = useStudio();
  const [closed, setClosed] = useState(false); // 종료 후엔 원장이 아니므로 미리보기를 다시 부르지 않는다
  const preview = useCloseStudioPreview(studioId, isOwner && !closed);
  const closeStudio = useCloseStudio();
  const [typed, setTyped] = useState('');
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  const name = studio?.name ?? '';
  const matches = typed.trim() === name && name.length > 0;

  const header = (
    <View className="flex-row items-center px-3 py-2">
      <Pressable onPress={goBack} accessibilityLabel="뒤로" className="h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
        <Ionicons name="chevron-back" size={24} color="#2F3842" />
      </Pressable>
      <Text className="ml-1 flex-1 text-lg font-bold text-ink">스튜디오 운영 종료</Text>
    </View>
  );

  if (!isOwner && !closed) {
    return (
      <Screen>
        {header}
        <ErrorView message="원장만 스튜디오 운영을 종료할 수 있습니다." />
      </Screen>
    );
  }
  if (preview.isLoading) {
    return (
      <Screen>
        {header}
        <LoadingView />
      </Screen>
    );
  }
  if (!closed && (preview.isError || !preview.data)) {
    return (
      <Screen>
        {header}
        <ErrorView message={preview.error?.message ?? '정보를 불러오지 못했습니다.'} onRetry={() => void preview.refetch()} />
      </Screen>
    );
  }
  const p = preview.data ?? { classes: 0, bookings: 0, members: 0 };

  const run = () => {
    setClosed(true);
    closeStudio.mutate(
      { studioId, confirmName: typed.trim() },
      {
        onSuccess: async (r) => {
          await useAuthStore.getState().loadAccount();
          showDialog(
            '운영을 종료했습니다',
            `수업 ${r.classes}개를 폐강하고 예약 ${r.bookings}건을 취소했어요. ${r.notified}명에게 종료 알림을 보냈어요.\n기록은 그대로 보관됩니다.`,
            [{ text: '확인', onPress: () => router.replace('/') }],
          );
        },
        onError: (e) => {
          setClosed(false);
          showDialog('운영을 종료하지 못했습니다', e.message);
        },
      },
    );
  };

  const confirm = () =>
    showDialog('정말 종료할까요?', `${name} 운영을 종료하면 되돌릴 수 없어요. 회원과 강사는 더 이상 이 스튜디오에 들어올 수 없어요.`, [
      { text: '닫기', style: 'cancel' },
      { text: '운영 종료', style: 'destructive', onPress: run },
    ]);

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
          <Text className="text-base leading-6 text-stone-700">
            <Text className="font-bold text-ink">{name}</Text> 운영을 종료하면 아래처럼 처리돼요.
          </Text>

          <View className="mt-4 flex-row gap-2">
            <Stat label="폐강될 수업" value={p.classes} />
            <Stat label="취소될 예약·대기" value={p.bookings} />
            <Stat label="알림 받을 사람" value={p.members} />
          </View>

          <Card icon="close-circle-outline" color="#E11D48" title="바로 처리돼요">
            {['앞으로의 수업은 모두 폐강되고, 확정 예약에 쓴 수강권 횟수는 돌려줘요', '회원·강사·실장에게 "운영 종료" 알림을 한 번 보내요', '모든 사람이 스튜디오에서 나가고, 초대 코드로도 다시 들어올 수 없어요']}
          </Card>
          <Card icon="archive-outline" color="#78716C" title="그대로 남아요">
            {['지난 예약·출석, 수강권, 결제 기록 (정산·세무용)', '내 계정 — 다른 스튜디오는 계속 이용할 수 있고, 원하면 그다음에 탈퇴할 수 있어요']}
          </Card>
          <Card icon="people-outline" color="#0B7A4D" title="운영을 넘기고 싶다면">
            {['종료 대신 회원 탭에서 다른 사람을 "원장"으로 지정하면 스튜디오가 계속 운영돼요']}
          </Card>

          <Text className="mb-2 mt-6 text-sm font-semibold text-stone-600">확인을 위해 스튜디오 이름을 입력해 주세요</Text>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder={name}
            placeholderTextColor="#A8A29E"
            accessibilityLabel="스튜디오 이름 확인"
            autoCorrect={false}
            className="rounded-2xl border border-stone-200 bg-white px-4 py-3.5 text-[16px] text-ink"
          />

          <Pressable
            onPress={confirm}
            disabled={!matches || closeStudio.isPending}
            accessibilityRole="button"
            accessibilityLabel="스튜디오 운영 종료하기"
            className={`mt-4 items-center rounded-2xl py-4 active:opacity-80 ${matches && !closeStudio.isPending ? 'bg-rose-600' : 'bg-rose-200'}`}>
            {closeStudio.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-base font-bold text-white">운영 종료하기</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-1 items-center rounded-2xl bg-surface py-3">
      <Text className="text-xl font-bold text-ink">{value}</Text>
      <Text className="mt-0.5 text-xs text-stone-500">{label}</Text>
    </View>
  );
}

function Card({ icon, color, title, children }: { icon: keyof typeof Ionicons.glyphMap; color: string; title: string; children: string[] }) {
  return (
    <View className="mt-3 rounded-2xl bg-surface p-4">
      <View className="flex-row items-center">
        <Ionicons name={icon} size={18} color={color} />
        <Text className="ml-2 text-base font-bold text-ink">{title}</Text>
      </View>
      {children.map((t) => (
        <Text key={t} className="mt-2 text-sm leading-5 text-stone-600">
          · {t}
        </Text>
      ))}
    </View>
  );
}
