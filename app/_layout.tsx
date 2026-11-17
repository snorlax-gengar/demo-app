import '../global.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DialogHost } from '@/components/DialogHost';
import { isStaffRole } from '@/lib/labels';
import { queryClient } from '@/lib/queryClient';
import { useActiveMembership, useAuthStore } from '@/stores/auth';

export default function RootLayout() {
  const session = useAuthStore((s) => s.session);
  const initialized = useAuthStore((s) => s.initialized);
  const accountLoaded = useAuthStore((s) => s.accountLoaded);
  const profileError = useAuthStore((s) => s.profileError);
  const hasStudio = useAuthStore((s) => s.memberships.length > 0);
  const role = useActiveMembership()?.role ?? null;

  useEffect(() => useAuthStore.getState().initialize(), []);

  // 세션 복원 중이거나, 로그인은 됐지만 아직 소속·역할을 모르는 동안에는 어떤 화면도 보여주지 않는다
  const booting = !initialized || (!!session && !accountLoaded);
  const signedIn = !!session;

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        {booting ? (
          <BootScreen error={session ? profileError : null} />
        ) : (
          // One-App: 지금 선택된 스튜디오에서의 역할에 따라 접근 가능한 그룹이 하나만 열린다.
          // guard 가 false 인 그룹은 URL/딥링크로도 진입할 수 없다.
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Protected guard={!signedIn}>
              <Stack.Screen name="(auth)" />
            </Stack.Protected>
            {/* 가입 직후 소속 스튜디오가 없으면: 만들기 또는 초대 코드로 참여 */}
            <Stack.Protected guard={signedIn && !hasStudio}>
              <Stack.Screen name="(onboarding)" />
            </Stack.Protected>
            <Stack.Protected guard={signedIn && hasStudio && role === 'member'}>
              <Stack.Screen name="(member)" />
            </Stack.Protected>
            <Stack.Protected guard={signedIn && hasStudio && isStaffRole(role)}>
              <Stack.Screen name="(admin)" />
            </Stack.Protected>
            {/* 이미 소속이 있는 사람이 다른 스튜디오를 추가할 때 */}
            <Stack.Protected guard={signedIn && hasStudio}>
              <Stack.Screen name="add-studio" />
            </Stack.Protected>
          </Stack>
        )}
        <DialogHost />
      </SafeAreaProvider>
    </QueryClientProvider>
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
        <ActivityIndicator color="#24766A" />
      )}
    </View>
  );
}
