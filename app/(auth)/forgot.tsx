import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authRedirect } from '@/lib/authLinks';
import { supabase } from '@/lib/supabase';

/** 비밀번호 찾기: 가입한 이메일로 재설정 링크 보내기 */
export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());

  const send = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: authRedirect('/reset-password') });
    setBusy(false);
    // 가입하지 않은 이메일인지 알려주지 않는다(계정 존재 여부 노출 방지). 너무 자주 요청한 경우만 안내
    if (e && /rate|seconds/i.test(e.message)) {
      setError('잠시 후 다시 시도해 주세요. (메일은 1분에 한 번 보낼 수 있어요)');
      return;
    }
    setSent(true);
  };

  return (
    <View className="flex-1 bg-canvas px-6" style={{ paddingTop: insets.top + 8 }}>
      <Pressable onPress={() => router.back()} accessibilityLabel="뒤로" className="-ml-2 h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
        <Ionicons name="chevron-back" size={24} color="#1B1F1E" />
      </Pressable>
      <Text className="mt-4 text-3xl font-bold text-ink">비밀번호 찾기</Text>
      {sent ? (
        <>
          <Text className="mt-3 text-base leading-6 text-stone-600">
            {email.trim()} 로 가입된 계정이 있으면 재설정 메일을 보냈어요. 메일의 링크를 이 휴대폰에서 눌러 새 비밀번호를 정해 주세요.
          </Text>
          <Text className="mt-2 text-sm text-stone-500">메일이 안 보이면 스팸함도 확인해 주세요.</Text>
          <Pressable onPress={() => router.replace('/(auth)')} className="mt-8 items-center rounded-2xl bg-brand-600 py-4 active:opacity-80">
            <Text className="text-base font-bold text-white">로그인으로</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text className="mt-2 text-base text-stone-500">가입한 이메일을 입력하면 비밀번호 재설정 링크를 보내드려요.</Text>
          <Text className="mb-2 mt-6 text-sm font-semibold text-stone-600">이메일</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="name@example.com"
            placeholderTextColor="#A8A29E"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            onSubmitEditing={send}
            className="rounded-2xl border border-stone-200 bg-white px-4 py-4 text-[16px] text-ink"
          />
          {error ? <Text className="mt-3 text-sm text-rose-600">{error}</Text> : null}
          <Pressable
            onPress={send}
            disabled={!valid || busy}
            accessibilityRole="button"
            accessibilityLabel="재설정 메일 보내기"
            className={`mt-6 items-center rounded-2xl py-4 active:opacity-80 ${valid && !busy ? 'bg-brand-600' : 'bg-brand-200'}`}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-base font-bold text-white">재설정 메일 보내기</Text>}
          </Pressable>
        </>
      )}
    </View>
  );
}
