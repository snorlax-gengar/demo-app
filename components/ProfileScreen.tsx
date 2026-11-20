import { Ionicons } from '@expo/vector-icons';
import type { UserIdentity } from '@supabase/supabase-js';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/ui';
import {
  useNotifications,
  useRegenerateInviteCode,
  useRevenue,
  useStudioPage,
  useTrialRequests,
  useUpdateProfile,
  useUpdateStudioName,
} from '@/hooks/queries';
import { PUSH_STATUS_TEXT, usePushStore } from '@/lib/push';
import { useStudio } from '@/hooks/useStudio';
import { dayjs, formatDate } from '@/lib/date';
import { showDialog } from '@/lib/dialog';
import { ROLE_LABEL, formatWon } from '@/lib/labels';
import {
  SOCIAL_LABEL,
  appleAvailable,
  getLinkedIdentities,
  linkSocialAccount,
  unlinkSocialAccount,
  type SocialProvider,
} from '@/lib/socialAuth';
import { useAuthStore } from '@/stores/auth';

const GOOGLE_G = require('../assets/images/social/google-g.png');

/** 회원/직원 공용 '내 정보': 현재 스튜디오, 초대 코드(원장·관리자), 스튜디오 전환·추가, 로그아웃 */
export function ProfileScreen() {
  const router = useRouter();
  const profile = useAuthStore((s) => s.profile);
  const memberships = useAuthStore((s) => s.memberships);
  const setActiveStudio = useAuthStore((s) => s.setActiveStudio);
  const signOut = useAuthStore((s) => s.signOut);
  const { studioId, studio, role, isAdmin, isOwner } = useStudio();
  const thisMonth = useMemo(() => dayjs().startOf('month'), []);
  const unread = (useNotifications().data ?? []).filter((n) => !n.read_at).length;
  const pushStatus = usePushStore((s) => s.status);
  const revenue = useRevenue(studioId, thisMonth, isOwner);
  const studioPage = useStudioPage(studioId, isAdmin);
  const trials = useTrialRequests(studioId, isAdmin);
  const newTrials = (trials.data ?? []).filter((t) => t.status === 'new').length;
  const regenerate = useRegenerateInviteCode();
  const updateProfile = useUpdateProfile();
  const updateStudioName = useUpdateStudioName();

  const [editingProfile, setEditingProfile] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');

  const [editingStudio, setEditingStudio] = useState(false);
  const [studioNameDraft, setStudioNameDraft] = useState('');

  if (!profile || !studio) return null;

  const openProfileEdit = () => {
    setNameDraft(profile.name ?? '');
    setPhoneDraft(profile.phone ?? '');
    setEditingProfile(true);
  };

  const saveProfile = () => {
    if (!nameDraft.trim()) {
      showDialog('이름을 입력해 주세요');
      return;
    }
    updateProfile.mutate(
      { name: nameDraft, phone: phoneDraft },
      {
        onSuccess: () => setEditingProfile(false),
        onError: (error) => showDialog('저장할 수 없습니다', error.message),
      },
    );
  };

  const openStudioEdit = () => {
    setStudioNameDraft(studio.name);
    setEditingStudio(true);
  };

  const saveStudioName = () => {
    if (!studioNameDraft.trim()) {
      showDialog('스튜디오 이름을 입력해 주세요');
      return;
    }
    updateStudioName.mutate(
      { studioId, name: studioNameDraft },
      {
        onSuccess: () => setEditingStudio(false),
        onError: (error) => showDialog('변경할 수 없습니다', error.message),
      },
    );
  };

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
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 }}>
        <Text className="text-2xl font-bold text-ink">내 정보</Text>

        {/* 프로필 */}
        <View className="mt-5 rounded-3xl bg-surface p-5">
          <View className="flex-row items-center">
            <View className="h-14 w-14 items-center justify-center rounded-full bg-brand-100">
              <Text className="text-xl font-bold text-brand-700">{profile.name.slice(0, 1) || '?'}</Text>
            </View>
            <View className="ml-4 flex-1">
              <Text className="text-lg font-bold text-ink">{profile.name || '이름 없음'}</Text>
              <Text className="mt-0.5 text-sm text-stone-500" numberOfLines={1}>
                {studio.name} · <Text className="font-semibold text-brand-600">{role ? ROLE_LABEL[role] : ''}</Text>
              </Text>
            </View>
            {!editingProfile ? (
              <Pressable
                onPress={openProfileEdit}
                accessibilityRole="button"
                accessibilityLabel="내 정보 수정"
                hitSlop={6}
                className="rounded-full bg-white px-3 py-1.5 active:opacity-70">
                <Text className="text-xs font-semibold text-stone-600">수정</Text>
              </Pressable>
            ) : null}
          </View>

          {editingProfile ? (
            <View className="mt-4 border-t border-stone-200 pt-4">
              <Text className="mb-1.5 text-xs font-semibold text-stone-600">이름</Text>
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                placeholder="홍길동"
                placeholderTextColor="#A8A29E"
                maxLength={20}
                textContentType="name"
                accessibilityLabel="이름"
                className="rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-[15px] text-ink"
              />
              <Text className="mb-1.5 mt-3 text-xs font-semibold text-stone-600">연락처 (선택)</Text>
              <TextInput
                value={phoneDraft}
                onChangeText={setPhoneDraft}
                placeholder="010-0000-0000"
                placeholderTextColor="#A8A29E"
                maxLength={20}
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                accessibilityLabel="연락처"
                className="rounded-xl border border-stone-200 bg-white px-3.5 py-3 text-[15px] text-ink"
              />
              <View className="mt-3 flex-row justify-end gap-2">
                <Pressable
                  onPress={() => setEditingProfile(false)}
                  disabled={updateProfile.isPending}
                  className="rounded-full px-4 py-2 active:opacity-70">
                  <Text className="text-sm font-semibold text-stone-500">취소</Text>
                </Pressable>
                <Pressable
                  onPress={saveProfile}
                  disabled={updateProfile.isPending}
                  className="min-w-[64px] items-center rounded-full bg-brand-600 px-4 py-2 active:opacity-80">
                  {updateProfile.isPending ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text className="text-sm font-semibold text-white">저장</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        {/* 알림함 (모든 역할) */}
        <Pressable
          onPress={() => router.push('/notifications')}
          accessibilityRole="button"
          accessibilityLabel="알림함"
          className="mt-4 flex-row items-center rounded-3xl bg-surface p-5 active:opacity-70">
          <View className="h-11 w-11 items-center justify-center rounded-full bg-brand-50">
            <Ionicons name="notifications-outline" size={20} color="#0B7A4D" />
          </View>
          <View className="ml-4 flex-1">
            <Text className="text-base font-bold text-ink">알림</Text>
            <Text className="mt-0.5 text-sm text-stone-500">{PUSH_STATUS_TEXT[pushStatus].split('.')[0]}</Text>
          </View>
          {unread ? (
            <View className="mr-2 min-w-[22px] items-center rounded-full bg-rose-500 px-1.5 py-0.5">
              <Text className="text-xs font-bold text-white">{unread}</Text>
            </View>
          ) : null}
          <Ionicons name="chevron-forward" size={20} color="#A8A29E" />
        </Pressable>

        {/* 매출 (원장 전용) */}
        {isOwner ? (
          <Pressable
            onPress={() => router.push('/(admin)/revenue')}
            accessibilityRole="button"
            accessibilityLabel="매출 보기"
            className="mt-4 flex-row items-center rounded-3xl bg-surface p-5 active:opacity-70">
            <View className="h-11 w-11 items-center justify-center rounded-full bg-brand-50">
              <Ionicons name="stats-chart" size={20} color="#0B7A4D" />
            </View>
            <View className="ml-4 flex-1">
              <Text className="text-sm text-stone-500">이번 달 매출 · 원장만 보임</Text>
              <Text className="mt-0.5 text-lg font-bold text-ink">
                {revenue.data ? formatWon(revenue.data.rows.reduce((s, r) => s + r.amount, 0)) : '—'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#A8A29E" />
          </Pressable>
        ) : null}

        {/* 소개 페이지 · 체험 신청 (원장·관리자) */}
        {isAdmin ? (
          <View className="mt-4 overflow-hidden rounded-3xl bg-surface">
            <Pressable
              onPress={() => router.push('/(admin)/studio-page')}
              accessibilityRole="button"
              accessibilityLabel="스튜디오 소개 페이지"
              className="flex-row items-center p-5 active:opacity-70">
              <View className="h-11 w-11 items-center justify-center rounded-full bg-brand-50">
                <Ionicons name="storefront-outline" size={20} color="#0B7A4D" />
              </View>
              <View className="ml-4 flex-1">
                <Text className="text-base font-bold text-ink">소개 페이지</Text>
                <Text className="mt-0.5 text-sm text-stone-500">
                  {studioPage.data?.published ? '공개 중 · 링크를 공유해 홍보하세요' : '사진·소개·체험 신청을 받는 공개 링크 만들기'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#A8A29E" />
            </Pressable>
            <Pressable
              onPress={() => router.push('/(admin)/trials')}
              accessibilityRole="button"
              accessibilityLabel="체험 신청"
              className="flex-row items-center border-t border-stone-200/70 p-5 active:opacity-70">
              <View className="h-11 w-11 items-center justify-center rounded-full bg-brand-50">
                <Ionicons name="sparkles-outline" size={20} color="#0B7A4D" />
              </View>
              <View className="ml-4 flex-1">
                <Text className="text-base font-bold text-ink">체험 신청</Text>
                <Text className="mt-0.5 text-sm text-stone-500">소개 페이지로 들어온 신청 확인·연락</Text>
              </View>
              {newTrials > 0 ? (
                <View className="mr-2 min-w-[22px] items-center rounded-full bg-rose-500 px-1.5 py-0.5">
                  <Text className="text-xs font-bold text-white">{newTrials}</Text>
                </View>
              ) : null}
              <Ionicons name="chevron-forward" size={20} color="#A8A29E" />
            </Pressable>
          </View>
        ) : null}

        {/* 수강권 상품 (원장·관리자) */}
        {isAdmin ? (
          <Pressable
            onPress={() => router.push('/(admin)/products')}
            accessibilityRole="button"
            accessibilityLabel="수강권 상품 관리"
            className="mt-4 flex-row items-center rounded-3xl bg-surface p-5 active:opacity-70">
            <View className="h-11 w-11 items-center justify-center rounded-full bg-brand-50">
              <Ionicons name="pricetags-outline" size={20} color="#0B7A4D" />
            </View>
            <View className="ml-4 flex-1">
              <Text className="text-base font-bold text-ink">수강권 상품 관리</Text>
              <Text className="mt-0.5 text-sm text-stone-500">횟수·기간·가격을 등록해 두고 발급 때 골라 쓰기</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#A8A29E" />
          </Pressable>
        ) : null}

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
                className="flex-1 flex-row items-center justify-center rounded-2xl bg-surface py-3 active:opacity-80">
                <Ionicons name="share-outline" size={16} color="#0B6E46" />
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
        <View className="rounded-3xl bg-surface px-5">
          <View className="py-4">
            <View className="flex-row items-center">
              <Ionicons name="checkmark-circle" size={20} color="#0B7A4D" />
              <Text className="ml-3 flex-1 text-base font-semibold text-ink" numberOfLines={1}>
                {studio.name}
              </Text>
              <Text className="text-sm text-stone-500">{role ? ROLE_LABEL[role] : ''} · 사용 중</Text>
              {isAdmin && !editingStudio ? (
                <Pressable
                  onPress={openStudioEdit}
                  accessibilityRole="button"
                  accessibilityLabel="스튜디오 이름 변경"
                  hitSlop={8}
                  className="ml-2 p-1 active:opacity-60">
                  <Ionicons name="create-outline" size={18} color="#78716C" />
                </Pressable>
              ) : null}
            </View>
            {editingStudio ? (
              <View className="mt-3">
                <TextInput
                  value={studioNameDraft}
                  onChangeText={setStudioNameDraft}
                  placeholder="스튜디오 이름"
                  placeholderTextColor="#A8A29E"
                  maxLength={40}
                  accessibilityLabel="스튜디오 이름"
                  className="rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-[15px] text-ink"
                />
                <View className="mt-2.5 flex-row justify-end gap-2">
                  <Pressable
                    onPress={() => setEditingStudio(false)}
                    disabled={updateStudioName.isPending}
                    className="rounded-full px-4 py-1.5 active:opacity-70">
                    <Text className="text-sm font-semibold text-stone-500">취소</Text>
                  </Pressable>
                  <Pressable
                    onPress={saveStudioName}
                    disabled={updateStudioName.isPending}
                    className="min-w-[60px] items-center rounded-full bg-brand-600 px-4 py-1.5 active:opacity-80">
                    {updateStudioName.isPending ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text className="text-sm font-semibold text-white">저장</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : null}
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
            <Ionicons name="add" size={20} color="#0B7A4D" />
            <Text className="ml-3 text-base font-semibold text-brand-700">다른 스튜디오 참여 · 만들기</Text>
          </Pressable>
        </View>

        {/* 계정 */}
        <Text className="mb-2 mt-6 text-sm font-semibold text-stone-600">계정</Text>
        <View className="rounded-3xl bg-surface px-5">
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

        {/* 간편 로그인 연결 */}
        <SocialLinkSection />

        <Pressable
          onPress={confirmSignOut}
          className="mt-6 items-center rounded-2xl border border-stone-300 bg-white py-4 active:opacity-80">
          <Text className="text-base font-semibold text-stone-600">로그아웃</Text>
        </Pressable>

        {/* 약관 · 탈퇴 */}
        <View className="mt-6 flex-row flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <Pressable onPress={() => router.push('/legal/terms')} accessibilityRole="link" hitSlop={8}>
            <Text className="text-xs text-stone-500 underline">이용약관</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/legal/privacy')} accessibilityRole="link" hitSlop={8}>
            <Text className="text-xs font-semibold text-stone-600 underline">개인정보 처리방침</Text>
          </Pressable>
          {isOwner ? (
            <Pressable onPress={() => router.push('/(admin)/close-studio')} accessibilityRole="link" hitSlop={8}>
              <Text className="text-xs text-stone-400 underline">스튜디오 운영 종료</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.push('/withdraw')} accessibilityRole="link" hitSlop={8}>
            <Text className="text-xs text-stone-400 underline">회원 탈퇴</Text>
          </Pressable>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const LINK_PROVIDERS: SocialProvider[] = ['kakao', 'google', 'apple'];

/** 내 계정에 카카오·구글 등 간편 로그인 수단 연결/해제 */
function SocialLinkSection() {
  const session = useAuthStore((s) => s.session);
  const [identities, setIdentities] = useState<UserIdentity[]>(() => session?.user.identities ?? []);
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [showApple, setShowApple] = useState(false);

  useEffect(() => {
    void appleAvailable().then(setShowApple);
  }, []);

  useEffect(() => {
    let alive = true;
    void getLinkedIdentities().then((list) => {
      if (alive) setIdentities(list);
    });
    return () => {
      alive = false;
    };
  }, [session?.user.id]);

  const byProvider = (p: SocialProvider) => identities.find((i) => i.provider === p);
  const visibleProviders = LINK_PROVIDERS.filter((p) => p !== 'apple' || showApple || Boolean(byProvider('apple')));
  const canUnlink = identities.length > 1;

  const onLink = async (provider: SocialProvider) => {
    if (busy) return;
    setBusy(provider);
    const err = await linkSocialAccount(provider);
    if (!err) {
      const next = await getLinkedIdentities();
      setIdentities(next);
      showDialog('연결했어요', `${SOCIAL_LABEL[provider]} 계정으로 바로 로그인할 수 있습니다.`);
    } else if (err !== 'cancelled') {
      showDialog('연결하지 못했어요', err);
    }
    setBusy(null);
  };

  const onUnlink = (provider: SocialProvider, identity: UserIdentity) => {
    if (busy) return;
    showDialog(
      `${SOCIAL_LABEL[provider]} 연결 해제`,
      `이 계정에서 ${SOCIAL_LABEL[provider]} 간편 로그인을 해제할까요? 다른 로그인 수단으로 계속 이용할 수 있습니다.`,
      [
        { text: '닫기', style: 'cancel' },
        {
          text: '해제',
          style: 'destructive',
          onPress: async () => {
            setBusy(provider);
            const err = await unlinkSocialAccount(identity);
            if (!err) {
              const next = await getLinkedIdentities();
              setIdentities(next);
            } else {
              showDialog('해제하지 못했어요', err);
            }
            setBusy(null);
          },
        },
      ],
    );
  };

  return (
    <>
      <Text className="mb-2 mt-6 text-sm font-semibold text-stone-600">간편 로그인 연결</Text>
      <View className="rounded-3xl bg-surface px-5">
        {visibleProviders.map((provider, index) => {
          const linked = byProvider(provider);
          const loading = busy === provider;
          return (
            <View
              key={provider}
              className={`flex-row items-center py-3.5 ${index > 0 ? 'border-t border-stone-100' : ''}`}>
              <View
                className={`h-8 w-8 items-center justify-center rounded-full ${
                  provider === 'kakao' ? 'bg-[#FEE500]' : provider === 'apple' ? 'bg-black' : 'border border-stone-200 bg-white'
                }`}>
                {provider === 'google' ? (
                  <Image source={GOOGLE_G} style={{ width: 15, height: 15 }} accessibilityIgnoresInvertColors />
                ) : (
                  <Ionicons
                    name={provider === 'kakao' ? 'chatbubble' : 'logo-apple'}
                    size={provider === 'apple' ? 16 : 14}
                    color={provider === 'kakao' ? '#191919' : '#FFFFFF'}
                  />
                )}
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-sm font-semibold text-ink">{SOCIAL_LABEL[provider]}</Text>
                <Text className={`text-xs ${linked ? 'text-brand-600' : 'text-stone-400'}`}>
                  {linked ? '연결됨' : '연결 안 됨'}
                </Text>
              </View>
              {loading ? (
                <ActivityIndicator size="small" color="#0B7A4D" />
              ) : linked ? (
                canUnlink ? (
                  <Pressable
                    onPress={() => onUnlink(provider, linked)}
                    disabled={!!busy}
                    accessibilityRole="button"
                    accessibilityLabel={`${SOCIAL_LABEL[provider]} 연결 해제`}
                    className="rounded-full border border-stone-300 bg-white px-3 py-1.5 active:opacity-70">
                    <Text className="text-xs font-semibold text-stone-600">해제</Text>
                  </Pressable>
                ) : (
                  <Text className="text-xs text-stone-400">기본 수단</Text>
                )
              ) : (
                <Pressable
                  onPress={() => void onLink(provider)}
                  disabled={!!busy}
                  accessibilityRole="button"
                  accessibilityLabel={`${SOCIAL_LABEL[provider]} 연결하기`}
                  className="rounded-full bg-brand-600 px-3.5 py-1.5 active:opacity-80">
                  <Text className="text-xs font-semibold text-white">연결</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </View>
    </>
  );
}
