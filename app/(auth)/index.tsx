import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
  const router = useRouter();
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
          <Image
            source={require('../../assets/images/icon.png')}
            accessibilityLabel="PIQ 로고"
            style={{ width: 56, height: 56, borderRadius: 14, borderWidth: 1, borderColor: '#E7E5E4' }}
          />
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

        <Pressable onPress={() => router.push('/forgot')} accessibilityRole="link" hitSlop={8} className="mt-3 self-end py-1">
          <Text className="text-sm text-stone-500">비밀번호를 잊으셨나요?</Text>
        </Pressable>

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
        <SocialButton provider="kakao" busy={social} onPress={onSocial} />
        {showApple ? <SocialButton provider="apple" busy={social} onPress={onSocial} /> : null}
        <SocialButton provider="google" busy={social} onPress={onSocial} />

        <View className="mt-6 flex-row justify-center">
          <Text className="text-sm text-stone-500">아직 계정이 없으신가요? </Text>
          <Pressable onPress={() => router.push('/signup')} accessibilityRole="link" hitSlop={8}>
            <Text className="text-sm font-semibold text-brand-600">회원가입</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// 간편 로그인 버튼: 세 개 모두 같은 높이·글자 크기. 색은 각 회사 안내(카카오 #FEE500 / 애플 검정 / 구글 흰색+컬러 G)
const SOCIAL_STYLE = {
  kakao: { label: '카카오로 계속하기', box: 'bg-[#FEE500]', text: 'text-[#191919]', spinner: '#191919' },
  apple: { label: 'Apple로 계속하기', box: 'bg-black', text: 'text-white', spinner: '#FFFFFF' },
  google: { label: 'Google로 계속하기', box: 'border border-stone-300 bg-white', text: 'text-ink', spinner: '#2F3842' },
} as const;
const GOOGLE_G = require('../../assets/images/social/google-g.png');

function SocialButton({ provider, busy, onPress }: { provider: SocialProvider; busy: SocialProvider | null; onPress: (p: SocialProvider) => void }) {
  const st = SOCIAL_STYLE[provider];
  return (
    <Pressable
      onPress={() => onPress(provider)}
      disabled={!!busy}
      accessibilityRole="button"
      accessibilityLabel={st.label}
      className={`mb-2.5 h-[52px] flex-row items-center justify-center rounded-2xl active:opacity-80 ${st.box}`}>
      {busy === provider ? (
        <ActivityIndicator color={st.spinner} />
      ) : (
        <>
          <View className="w-5 items-center">
            {provider === 'google' ? (
              <Image source={GOOGLE_G} style={{ width: 18, height: 18 }} accessibilityIgnoresInvertColors />
            ) : (
              <Ionicons name={provider === 'kakao' ? 'chatbubble' : 'logo-apple'} size={provider === 'apple' ? 20 : 18} color={st.spinner} />
            )}
          </View>
          <Text className={`ml-2 text-base font-semibold ${st.text}`}>{st.label}</Text>
        </>
      )}
    </Pressable>
  );
}
