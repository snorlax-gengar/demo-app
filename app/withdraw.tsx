import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/ui';
import { withdrawAccount } from '@/lib/account';
import { showDialog } from '@/lib/dialog';
import { useAuthStore } from '@/stores/auth';

const REMOVED = ['이름·연락처·이메일', '스튜디오가 남긴 회원 메모', '알림 내역과 이 기기의 알림 설정', '로그인 계정 (같은 이메일로 새로 가입은 가능)'];
const KEPT = ['지난 예약·출석 기록', '수강권과 결제 기록', '→ 스튜디오 화면에는 "탈퇴 회원"으로만 보여요'];

/** 회원 탈퇴: 개인정보는 지우고, 스튜디오의 예약·출석·결제 기록은 익명으로 남긴다 */
export default function WithdrawScreen() {
  const router = useRouter();
  const signOut = useAuthStore((s) => s.signOut);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const run = async () => {
    setBusy(true);
    const r = await withdrawAccount();
    setBusy(false);
    if (!r.ok) {
      showDialog('탈퇴할 수 없습니다', r.message);
      return;
    }
    showDialog('탈퇴가 완료됐어요', '그동안 이용해 주셔서 감사합니다.', [{ text: '확인', onPress: () => void signOut() }]);
  };

  const confirm = () =>
    showDialog('정말 탈퇴할까요?', '탈퇴하면 되돌릴 수 없어요. 앞으로 잡힌 예약과 대기도 모두 취소돼요.', [
      { text: '닫기', style: 'cancel' },
      { text: '탈퇴하기', style: 'destructive', onPress: () => void run() },
    ]);

  return (
    <Screen>
      <View className="flex-row items-center px-3 py-2">
        <Pressable onPress={goBack} accessibilityLabel="뒤로" className="h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
          <Ionicons name="chevron-back" size={24} color="#2F3842" />
        </Pressable>
        <Text className="ml-1 flex-1 text-lg font-bold text-ink">회원 탈퇴</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}>
        <Text className="text-base leading-6 text-stone-700">탈퇴하기 전에 아래 내용을 확인해 주세요.</Text>

        <Section icon="trash-outline" color="#E11D48" title="바로 삭제돼요" items={REMOVED} />
        <Section icon="archive-outline" color="#78716C" title="스튜디오 운영을 위해 남아요" items={KEPT} />
        <Section
          icon="alert-circle-outline"
          color="#B45309"
          title="이런 경우엔 먼저 정리해 주세요"
          items={['다른 원장이 없는 스튜디오의 원장 → 다른 사람을 원장으로 지정하거나, 내 정보에서 스튜디오 운영 종료', '혼자 운영 중인 스튜디오(다른 회원·강사 없음)는 탈퇴와 함께 자동으로 운영 종료돼요', '진행 예정인 담당 수업이 있는 강사 → 폐강 또는 강사 변경', '앞으로의 예약·대기는 탈퇴와 함께 취소되고 수강권 횟수는 돌려받지 않아요']}
        />

        <Pressable
          onPress={() => setAgreed((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel="안내를 모두 확인했어요"
          className="mt-6 flex-row items-center rounded-2xl bg-surface px-4 py-4 active:opacity-70">
          <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={22} color={agreed ? '#0B7A4D' : '#A8A29E'} />
          <Text className="ml-3 flex-1 text-base text-ink">안내를 모두 확인했어요</Text>
        </Pressable>

        <Pressable
          onPress={confirm}
          disabled={!agreed || busy}
          accessibilityRole="button"
          accessibilityLabel="회원 탈퇴하기"
          className={`mt-4 items-center rounded-2xl py-4 active:opacity-80 ${agreed && !busy ? 'bg-rose-600' : 'bg-rose-200'}`}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-base font-bold text-white">회원 탈퇴하기</Text>}
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function Section({ icon, color, title, items }: { icon: keyof typeof Ionicons.glyphMap; color: string; title: string; items: string[] }) {
  return (
    <View className="mt-4 rounded-2xl bg-surface p-4">
      <View className="flex-row items-center">
        <Ionicons name={icon} size={18} color={color} />
        <Text className="ml-2 text-base font-bold text-ink">{title}</Text>
      </View>
      {items.map((t) => (
        <Text key={t} className="mt-2 text-sm leading-5 text-stone-600">
          {t.startsWith('→') ? t : `· ${t}`}
        </Text>
      ))}
    </View>
  );
}
