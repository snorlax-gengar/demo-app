import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
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

import { appleAvailable, signInWithApple, signInWithBrowser, type SocialProvider, type SocialResult } from '@/lib/socialAuth';
import { supabase } from '@/lib/supabase';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [social, setSocial] = useState<SocialProvider | null>(null);
  const [showApple, setShowApple] = useState(false);
  useEffect(() => {
    void appleAvailable().then(setShowApple);
  }, []);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !loading;

  const onSocial = async (provider: SocialProvider) => {
    if (social) return;
    setSocial(provider);
    setError(null);
    const r: SocialResult = provider === 'apple' ? await signInWithApple() : await signInWithBrowser(provider);
    setSocial(null);
    if (r && r !== 'cancelled') setError(r);
    // 성공하면 루트 레이아웃이 처음이면 약관 동의, 아니면 내 화면으로 보낸다
  };

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
          : /not confirmed/i.test(signInError.message)
            ? '이메일 인증이 아직 안 됐어요. 가입할 때 받은 메일의 링크를 눌러 주세요.'
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

        <Link href="/forgot" className="mt-3 self-end py-1 text-sm text-stone-500">
          비밀번호를 잊으셨나요?
        </Link>

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

        {/* 간편 로그인 */}
        <View className="my-6 flex-row items-center">
          <View className="h-px flex-1 bg-stone-200" />
          <Text className="mx-3 text-xs text-stone-400">또는 간편하게</Text>
          <View className="h-px flex-1 bg-stone-200" />
        </View>
        <Pressable
          onPress={() => void onSocial('kakao')}
          disabled={!!social}
          accessibilityRole="button"
          accessibilityLabel="카카오로 계속하기"
          className="h-[52px] flex-row items-center justify-center rounded-2xl bg-[#FEE500] active:opacity-80">
          {social === 'kakao' ? (
            <ActivityIndicator color="#191919" />
          ) : (
            <>
              <Ionicons name="chatbubble" size={18} color="#191919" />
              <Text className="ml-2 text-base font-semibold text-[#191919]">카카오로 계속하기</Text>
            </>
          )}
        </Pressable>
        {showApple ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={16}
            style={{ height: 52, marginTop: 10 }}
            onPress={() => void onSocial('apple')}
          />
        ) : null}
        <Pressable
          onPress={() => void onSocial('google')}
          disabled={!!social}
          accessibilityRole="button"
          accessibilityLabel="Google로 계속하기"
          className="mt-2.5 h-[52px] flex-row items-center justify-center rounded-2xl border border-stone-300 bg-white active:opacity-80">
          {social === 'google' ? (
            <ActivityIndicator color="#1B1F1E" />
          ) : (
            <>
              <Ionicons name="logo-google" size={18} color="#1B1F1E" />
              <Text className="ml-2 text-base font-semibold text-ink">Google로 계속하기</Text>
            </>
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
