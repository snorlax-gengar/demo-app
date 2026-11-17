import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Share, Text, View } from 'react-native';

import { Screen } from '@/components/ui';
import { useRegenerateInviteCode } from '@/hooks/queries';
import { useStudio } from '@/hooks/useStudio';
import { formatDate } from '@/lib/date';
import { showDialog } from '@/lib/dialog';
import { ROLE_LABEL } from '@/lib/labels';
import { useAuthStore } from '@/stores/auth';

/** 회원/직원 공용 '내 정보': 현재 스튜디오, 초대 코드(원장·관리자), 스튜디오 전환·추가, 로그아웃 */
export function ProfileScreen() {
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const memberships = useAuthStore((s) => s.memberships);
  const setActiveStudio = useAuthStore((s) => s.setActiveStudio);
  const signOut = useAuthStore((s) => s.signOut);
  const { studioId, studio, role, isAdmin } = useStudio();
  const regenerate = useRegenerateInviteCode();

  if (!profile || !studio) return null;

  const others = memberships.filter((m) => m.studio_id !== studioId);

  const shareCode = async () => {
    const message = `[${studio.name}] 예약 앱 초대 코드: ${studio.invite_code}\n앱 가입 후 '초대 코드로 참여'에 입력해 주세요.`;
    try {
      await Share.share({ message });
    } catch {
      // 웹 등 공유 시트가 없는 환경
      showDialog('초대 코드', `${studio.invite_code}\n\n이 코드를 회원·강사에게 알려주세요.`);
    }
  };

  const confirmRegenerate = () =>
    showDialog('초대 코드 바꾸기', '새 코드를 만들면 기존 코드로는 더 이상 참여할 수 없습니다. 이미 참여한 사람은 그대로입니다.', [
      { text: '닫기', style: 'cancel' },
      {
        text: '새 코드 만들기',
        style: 'destructive',
        onPress: () =>
          regenerate.mutate(studioId, {
            onSuccess: (code) => showDialog('새 초대 코드', code),
            onError: (error) => showDialog('바꿀 수 없습니다', error.message),
          }),
      },
    ]);

  const switchTo = (id: string, name: string) =>
    showDialog(`${name}(으)로 전환할까요?`, undefined, [
      { text: '닫기', style: 'cancel' },
      { text: '전환', onPress: () => { setActiveStudio(id); router.replace('/'); } },
    ]);

  const confirmSignOut = () =>
    showDialog('로그아웃', '로그아웃할까요?', [
      { text: '닫기', style: 'cancel' },
      { text: '로그아웃', style: 'destructive', onPress: () => void signOut() },
    ]);

  const rows: { icon: 'mail-outline' | 'call-outline' | 'calendar-outline'; label: string; value: string }[] = [
    { icon: 'mail-outline', label: '이메일', value: profile.email ?? '-' },
    { icon: 'call-outline', label: '연락처', value: profile.phone ?? '-' },
    { icon: 'calendar-outline', label: '가입일', value: formatDate(profile.created_at) },
  ];

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 }}>
        <Text className="text-2xl font-bold text-ink">내 정보</Text>

        {/* 프로필 */}
        <View className="mt-5 flex-row items-center rounded-3xl bg-white p-5">
          <View className="h-14 w-14 items-center justify-center rounded-full bg-brand-100">
            <Text className="text-xl font-bold text-brand-700">{profile.name.slice(0, 1) || '?'}</Text>
          </View>
          <View className="ml-4 flex-1">
            <Text className="text-lg font-bold text-ink">{profile.name || '이름 없음'}</Text>
            <Text className="mt-0.5 text-sm text-stone-500" numberOfLines={1}>
              {studio.name} · <Text className="font-semibold text-brand-600">{role ? ROLE_LABEL[role] : ''}</Text>
            </Text>
          </View>
        </View>

        {/* 초대 코드 (원장·관리자) */}
        {isAdmin ? (
          <View className="mt-4 rounded-3xl bg-brand-700 p-5">
            <Text className="text-sm font-semibold text-brand-100">초대 코드</Text>
            <Text selectable className="mt-1 text-3xl font-bold tracking-[6px] text-white">
              {studio.invite_code}
            </Text>
            <Text className="mt-2 text-xs text-brand-100">
              회원·강사가 앱 가입 후 이 코드를 입력하면 회원으로 들어옵니다. 강사는 회원 화면에서 역할을 바꿔 주세요.
            </Text>
            <View className="mt-4 flex-row gap-2">
              <Pressable
                onPress={() => void shareCode()}
                className="flex-1 flex-row items-center justify-center rounded-2xl bg-white py-3 active:opacity-80">
                <Ionicons name="share-outline" size={16} color="#1C5D54" />
                <Text className="ml-1.5 text-sm font-bold text-brand-700">공유하기</Text>
              </Pressable>
              <Pressable
                onPress={confirmRegenerate}
                disabled={regenerate.isPending}
                className="flex-row items-center justify-center rounded-2xl border border-brand-400 px-4 py-3 active:opacity-80">
                {regenerate.isPending ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text className="text-sm font-semibold text-white">코드 바꾸기</Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* 내 스튜디오 */}
        <Text className="mb-2 mt-6 text-sm font-semibold text-stone-600">내 스튜디오</Text>
        <View className="rounded-3xl bg-white px-5">
          <View className="flex-row items-center py-4">
            <Ionicons name="checkmark-circle" size={20} color="#24766A" />
            <Text className="ml-3 flex-1 text-base font-semibold text-ink" numberOfLines={1}>
              {studio.name}
            </Text>
            <Text className="text-sm text-stone-500">{role ? ROLE_LABEL[role] : ''} · 사용 중</Text>
          </View>
          {others.map((m) => (
            <Pressable
              key={m.studio_id}
              onPress={() => switchTo(m.studio_id, m.studio.name)}
              accessibilityLabel={`${m.studio.name}(으)로 전환`}
              className="flex-row items-center border-t border-stone-100 py-4 active:opacity-60">
              <Ionicons name="ellipse-outline" size={20} color="#A8A29E" />
              <Text className="ml-3 flex-1 text-base text-ink" numberOfLines={1}>
                {m.studio.name}
              </Text>
              <Text className="mr-1 text-sm text-stone-500">{ROLE_LABEL[m.role]}</Text>
              <Ionicons name="swap-horizontal" size={16} color="#A8A29E" />
            </Pressable>
          ))}
          <Pressable
            onPress={() => router.push('/add-studio')}
            className="flex-row items-center border-t border-stone-100 py-4 active:opacity-60">
            <Ionicons name="add" size={20} color="#24766A" />
            <Text className="ml-3 text-base font-semibold text-brand-700">다른 스튜디오 참여 · 만들기</Text>
          </Pressable>
        </View>

        {/* 계정 */}
        <Text className="mb-2 mt-6 text-sm font-semibold text-stone-600">계정</Text>
        <View className="rounded-3xl bg-white px-5">
          {rows.map((row, index) => (
            <View key={row.label} className={`flex-row items-center py-4 ${index > 0 ? 'border-t border-stone-100' : ''}`}>
              <Ionicons name={row.icon} size={18} color="#78716C" />
              <Text className="ml-3 w-16 text-sm text-stone-500">{row.label}</Text>
              <Text className="flex-1 text-right text-sm text-ink" numberOfLines={1}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>

        <Pressable
          onPress={confirmSignOut}
          className="mt-6 items-center rounded-2xl border border-stone-300 bg-white py-4 active:opacity-80">
          <Text className="text-base font-semibold text-stone-600">로그아웃</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
