import { Link } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (signInError) {
      setError(
        signInError.message === 'Invalid login credentials'
          ? '이메일 또는 비밀번호가 올바르지 않습니다.'
          : signInError.message,
      );
    }
    // 성공 시에는 루트 레이아웃이 role 을 읽어 알맞은 탭으로 자동 전환한다
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-canvas"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingHorizontal: 24,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        }}>
        <View className="mb-10">
          <View className="h-12 w-16 items-center justify-center rounded-2xl bg-brand-600">
            <Text className="text-lg font-extrabold tracking-wider text-white">PIQ</Text>
          </View>
          <Text className="mt-5 text-3xl font-bold text-ink">로그인</Text>
          <Text className="mt-2 text-base text-stone-500">수업 예약과 일정을 한 곳에서 관리하세요.</Text>
        </View>

        <Text className="mb-2 text-sm font-semibold text-stone-600">이메일</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="name@example.com"
          placeholderTextColor="#A8A29E"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          className="rounded-2xl border border-stone-200 bg-white px-4 py-4 text-[16px] text-ink"
        />

        <Text className="mb-2 mt-4 text-sm font-semibold text-stone-600">비밀번호</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="비밀번호"
          placeholderTextColor="#A8A29E"
          secureTextEntry
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
          className="rounded-2xl border border-stone-200 bg-white px-4 py-4 text-[16px] text-ink"
        />

        {error ? <Text className="mt-3 text-sm text-rose-600">{error}</Text> : null}

        <Pressable
          onPress={onSubmit}
          disabled={!canSubmit}
          className={`mt-6 items-center rounded-2xl py-4 active:opacity-80 ${canSubmit ? 'bg-brand-600' : 'bg-brand-200'}`}>
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="text-base font-bold text-white">로그인</Text>
          )}
        </Pressable>

        <View className="mt-6 flex-row justify-center">
          <Text className="text-sm text-stone-500">아직 계정이 없으신가요? </Text>
          <Link href="/signup" className="text-sm font-semibold text-brand-600">
            회원가입
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
