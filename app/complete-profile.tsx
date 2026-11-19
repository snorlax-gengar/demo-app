import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LEGAL_INFO } from '@/lib/legal';
import { nameFromMetadata } from '@/lib/socialAuth';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth';

/**
 * 약관 동의 + 이름 확인. 소셜 로그인으로 처음 들어온 사람(가입 화면을 거치지 않음)과
 * 약관이 생기기 전에 가입한 사람이 한 번 거친다. 동의 시각은 계정 정보(user_metadata)에 남긴다.
 */
export default function CompleteProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const meta = session?.user.user_metadata as Record<string, unknown> | undefined;
  const provider = (session?.user.app_metadata?.provider as string | undefined) ?? 'email';
  const [name, setName] = useState(() => (profile?.name || nameFromMetadata(meta)).slice(0, 20));
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim().length > 0 && agreed;

  const submit = async () => {
    if (!valid || busy || !session) return;
    setBusy(true);
    setError(null);
    const trimmed = name.trim();
    const { error: e1 } = await supabase.from('users').update({ name: trimmed }).eq('id', session.user.id);
    const { error: e2 } = await supabase.auth.updateUser({
      data: { name: trimmed, terms_agreed_at: new Date().toISOString(), terms_version: LEGAL_INFO.effectiveDate },
    });
    setBusy(false);
    if (e1 || e2) {
      setError((e1 ?? e2)!.message);
      return;
    }
    await useAuthStore.getState().loadAccount();
    router.replace('/');
  };

  return (
    <KeyboardAvoidingView className="flex-1 bg-canvas" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 24, paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }}>
        <Text className="text-3xl font-bold text-ink">{provider === 'email' ? '약관 동의' : '거의 다 됐어요'}</Text>
        <Text className="mt-2 text-base text-stone-500">
          {provider === 'email' ? '서비스 약관이 새로 생겼어요. 확인 후 계속 이용해 주세요.' : '스튜디오에서 보일 이름을 확인하고 약관에 동의해 주세요.'}
        </Text>

        <Text className="mb-2 mt-6 text-sm font-semibold text-stone-600">이름</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="홍길동"
          placeholderTextColor="#A8A29E"
          maxLength={20}
          textContentType="name"
          className="rounded-2xl border border-stone-200 bg-white px-4 py-4 text-[16px] text-ink"
        />
        <Text className="mt-1.5 text-xs text-stone-500">원장님·강사님이 출석부와 예약 명단에서 보는 이름이에요.</Text>

        <View className="mt-6 flex-row items-start">
          <Pressable
            onPress={() => setAgreed((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            accessibilityLabel="이용약관과 개인정보 처리방침에 동의"
            hitSlop={6}>
            <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={22} color={agreed ? '#0B7A4D' : '#A8A29E'} />
          </Pressable>
          <Text className="ml-2 flex-1 text-sm leading-6 text-stone-600">
            <Text onPress={() => router.push('/legal/terms')} className="font-semibold text-brand-700 underline">
              이용약관
            </Text>
            {' 및 '}
            <Text onPress={() => router.push('/legal/privacy')} className="font-semibold text-brand-700 underline">
              개인정보 처리방침
            </Text>
            {'에 동의합니다 (필수, 만 14세 이상)'}
          </Text>
        </View>

        {error ? <Text className="mt-3 text-sm text-rose-600">{error}</Text> : null}
        <Pressable
          onPress={submit}
          disabled={!valid || busy}
          accessibilityRole="button"
          accessibilityLabel="동의하고 시작하기"
          className={`mt-6 items-center rounded-2xl py-4 active:opacity-80 ${valid && !busy ? 'bg-brand-600' : 'bg-brand-200'}`}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-base font-bold text-white">동의하고 시작하기</Text>}
        </Pressable>
        {provider !== 'email' ? (
          <View className="mt-5 rounded-2xl bg-surface px-4 py-3">
            <Text className="text-xs leading-5 text-stone-500">
              이미 이메일로 가입한 계정이 있으신가요? 아래 &apos;다른 계정으로 로그인&apos;에서 기존 계정으로 로그인한 뒤{' '}
              <Text className="font-semibold text-ink">[내 정보 &gt; 간편 로그인 연결]</Text>에서 연결해 주세요.
            </Text>
          </View>
        ) : null}
        <Pressable onPress={() => void signOut()} className="mt-4 items-center py-2">
          <Text className="text-sm font-semibold text-stone-500">다른 계정으로 로그인</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
