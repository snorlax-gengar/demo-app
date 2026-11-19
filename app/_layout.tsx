import '../global.css';

import { QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DialogHost } from '@/components/DialogHost';
import { isStaffRole } from '@/lib/labels';
import { pathFromNotification, registerForPush } from '@/lib/push';
import { queryClient } from '@/lib/queryClient';
import { SUPABASE_CONFIG_ERROR } from '@/lib/supabase';
import { useActiveMembership, useAuthStore } from '@/stores/auth';

export default function RootLayout() {
  const session = useAuthStore((s) => s.session);
  const initialized = useAuthStore((s) => s.initialized);
  const accountLoaded = useAuthStore((s) => s.accountLoaded);
  const profileError = useAuthStore((s) => s.profileError);
  const hasStudio = useAuthStore((s) => s.memberships.length > 0);
  const role = useActiveMembership()?.role ?? null;

  useEffect(() => useAuthStore.getState().initialize(), []);

  // 로그인(또는 계정 전환)할 때마다 이 기기를 푸시 대상으로 등록
  const userId = session?.user.id;
  useEffect(() => {
    if (userId && accountLoaded) void registerForPush();
  }, [userId, accountLoaded]);

  // 알림을 누르면 해당 화면으로, 앱을 켠 채 알림이 오면 알림함 새로고침
  const router = useRouter();
  const handledNotifId = useRef<string | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web' || !userId || !accountLoaded) return;
    // 알림을 누르면 알림함으로 (알림에 다른 경로가 지정돼 있으면 그쪽으로)
    const open = (data: unknown) => {
      const path = pathFromNotification(data);
      router.push((path && path !== '/' ? path : '/notifications') as never);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    };
    const last = Notifications.getLastNotificationResponse();
    if (last && handledNotifId.current !== last.notification.request.identifier) {
      handledNotifId.current = last.notification.request.identifier;
      open(last.notification.request.content.data);
    }
    const tap = Notifications.addNotificationResponseReceivedListener((r) => {
      handledNotifId.current = r.notification.request.identifier;
      open(r.notification.request.content.data);
    });
    const recv = Notifications.addNotificationReceivedListener(() => void queryClient.invalidateQueries({ queryKey: ['notifications'] }));
    return () => {
      tap.remove();
      recv.remove();
    };
  }, [userId, accountLoaded, router]);

  // 세션 복원 중이거나, 로그인은 됐지만 아직 소속·역할을 모르는 동안에는 어떤 화면도 보여주지 않는다
  const booting = !initialized || (!!session && !accountLoaded);
  const signedIn = !!session;
  // 약관 동의 기록이 없는 계정(소셜 로그인 첫 진입, 약관 이전 가입자)은 동의 화면부터
  const needsConsent = signedIn && !session?.user.user_metadata?.terms_agreed_at;
  const ready = signedIn && !needsConsent;

  // 동의 화면은 다른 화면보다 먼저: 로그인 직후 어떤 주소에 있든 동의 화면으로 보낸다
  const consentNeeded = !booting && needsConsent;
  useEffect(() => {
    if (consentNeeded) router.replace('/complete-profile');
  }, [consentNeeded, router]);

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {SUPABASE_CONFIG_ERROR ? (
          <ConfigErrorScreen message={SUPABASE_CONFIG_ERROR} />
        ) : booting ? (
          <BootScreen error={session ? profileError : null} />
        ) : (
          // One-App: 지금 선택된 스튜디오에서의 역할에 따라 접근 가능한 그룹이 하나만 열린다.
          // guard 가 false 인 그룹은 URL/딥링크로도 진입할 수 없다.
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Protected guard={!signedIn}>
              <Stack.Screen name="(auth)" />
            </Stack.Protected>
            {/* 가입 직후 소속 스튜디오가 없으면: 만들기 또는 초대 코드로 참여 */}
            <Stack.Protected guard={needsConsent}>
              <Stack.Screen name="complete-profile" />
            </Stack.Protected>
            <Stack.Protected guard={ready && !hasStudio}>
              <Stack.Screen name="(onboarding)" />
            </Stack.Protected>
            <Stack.Protected guard={ready && hasStudio && role === 'member'}>
              <Stack.Screen name="(member)" />
              <Stack.Screen name="my-pass/[id]" />
              <Stack.Screen name="my-history" />
            </Stack.Protected>
            <Stack.Protected guard={ready && hasStudio && isStaffRole(role)}>
              <Stack.Screen name="(admin)" />
            </Stack.Protected>
            {/* 이미 소속이 있는 사람이 다른 스튜디오를 추가할 때 / 알림함 */}
            <Stack.Protected guard={ready && hasStudio}>
              <Stack.Screen name="add-studio" />
              <Stack.Screen name="notifications" />
            </Stack.Protected>
            <Stack.Protected guard={ready}>
              <Stack.Screen name="withdraw" />
            </Stack.Protected>
            {/* 약관·개인정보 처리방침: 로그인 전후 모두 */}
            <Stack.Screen name="legal/[doc]" />
            {/* 비밀번호 재설정 메일 링크: 로그인 전후 모두 */}
            <Stack.Screen name="reset-password" />
            <Stack.Screen name="auth-callback" />
          </Stack>
        )}
        <DialogHost />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <View className="flex-1 items-center justify-center bg-canvas px-8">
      <Text className="text-center text-base font-semibold text-ink">앱 설정이 필요합니다</Text>
      <Text className="mt-2 text-center text-sm leading-5 text-stone-500">{message}</Text>
    </View>
  );
}

function BootScreen({ error }: { error: string | null }) {
  const loadAccount = useAuthStore((s) => s.loadAccount);
  const signOut = useAuthStore((s) => s.signOut);

  return (
    <View className="flex-1 items-center justify-center bg-canvas px-8">
      {error ? (
        <>
          <Text className="text-center text-base font-semibold text-ink">계정 정보를 불러오지 못했습니다</Text>
          <Text className="mt-2 text-center text-sm text-stone-500">{error}</Text>
          <Pressable
            onPress={() => void loadAccount()}
            className="mt-6 rounded-full bg-brand-600 px-6 py-3 active:opacity-80">
            <Text className="font-semibold text-white">다시 시도</Text>
          </Pressable>
          <Pressable onPress={() => void signOut()} className="mt-3 px-6 py-3">
            <Text className="font-semibold text-stone-500">로그아웃</Text>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator color="#0B7A4D" />
      )}
    </View>
  );
}
