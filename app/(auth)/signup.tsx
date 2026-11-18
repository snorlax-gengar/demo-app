import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';
import { showDialog } from '@/lib/dialog';
import { LEGAL_INFO } from '@/lib/legal';
import { authRedirect } from '@/lib/authLinks';

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && email.trim().length > 0 && password.length >= 6 && agreed && !loading;

  const onSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    // name/phone 은 DB 트리거(handle_new_user)가 users 테이블로 옮긴다. 소속 스튜디오는 가입 후 시작 화면에서 정한다.
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // 동의 시각·약관 시행일을 계정 정보에 남긴다 (동의 증빙)
      options: { emailRedirectTo: authRedirect('/'), data: { name: name.trim(), phone: phone.trim() || null, terms_agreed_at: new Date().toISOString(), terms_version: LEGAL_INFO.effectiveDate } },
    });
    setLoading(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    // 이메일 인증이 켜져 있으면 세션이 없다 → 안내 후 로그인 화면으로
    if (!data.session) {
      showDialog('인증 메일을 보냈습니다', '메일의 링크를 누른 뒤 로그인해 주세요.', [
        { text: '확인', onPress: () => router.replace('/(auth)') },
      ]);
    }
  };

  const fieldClass = 'rounded-2xl border border-stone-200 bg-white px-4 py-4 text-[16px] text-ink';
  const labelClass = 'mb-2 mt-4 text-sm font-semibold text-stone-600';

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
        <Text className="text-3xl font-bold text-ink">회원가입</Text>
        <Text className="mt-2 text-base text-stone-500">가입 후 초대 코드로 참여하거나 스튜디오를 직접 만들 수 있습니다.</Text>

        <Text className={labelClass}>이름</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="홍길동"
          placeholderTextColor="#A8A29E"
          textContentType="name"
          className={fieldClass}
        />

        <Text className={labelClass}>연락처 (선택)</Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="010-0000-0000"
          placeholderTextColor="#A8A29E"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          className={fieldClass}
        />

        <Text className={labelClass}>이메일</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="name@example.com"
          placeholderTextColor="#A8A29E"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          className={fieldClass}
        />

        <Text className={labelClass}>비밀번호 (6자 이상)</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="비밀번호"
          placeholderTextColor="#A8A29E"
          secureTextEntry
          textContentType="newPassword"
          className={fieldClass}
        />

        {/* 약관 동의 (필수) */}
        <View className="mt-5 flex-row items-start">
          <Pressable
            onPress={() => setAgreed((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            accessibilityLabel="이용약관과 개인정보 처리방침에 동의"
            hitSlop={6}
            className="flex-row items-center">
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
          onPress={onSubmit}
          disabled={!canSubmit}
          className={`mt-6 items-center rounded-2xl py-4 active:opacity-80 ${canSubmit ? 'bg-brand-600' : 'bg-brand-200'}`}>
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="text-base font-bold text-white">가입하기</Text>
          )}
        </Pressable>

        <Pressable onPress={() => router.replace('/(auth)')} className="mt-4 items-center py-2">
          <Text className="text-sm font-semibold text-stone-500">이미 계정이 있어요</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
