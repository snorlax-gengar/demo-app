import { Ionicons } from '@expo/vector-icons';
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

import { useCreateStudio, useJoinStudio } from '@/hooks/queries';
import { showDialog } from '@/lib/dialog';
import type { Studio } from '@/lib/types';
import { useAuthStore } from '@/stores/auth';

interface Props {
  /** 첫 가입 직후(소속 없음)인지, 이미 소속이 있는 사람이 추가하는 것인지 */
  mode: 'first' | 'add';
  onClose?: () => void;
  /** 성공 후 (새 스튜디오가 이미 '현재 스튜디오'로 선택된 상태) */
  onDone?: (studio: Studio) => void;
}

/** 초대 코드로 참여 / 새 스튜디오 만들기 */
export function StudioSetup({ mode, onClose, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const joinStudio = useJoinStudio();
  const createStudio = useCreateStudio();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const cleanCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const canJoin = cleanCode.length === 6 && !joinStudio.isPending;
  const canCreate = name.trim().length > 0 && !createStudio.isPending;

  const onJoin = () => {
    if (!canJoin) return;
    // mutate 의 onSuccess 는 성공 직후 이 화면이 사라지면(역할별 화면으로 자동 전환) 호출되지 않으므로
    // mutateAsync 의 결과로 안내한다
    joinStudio
      .mutateAsync(cleanCode)
      .then((studio) => {
        showDialog(`${studio.name}에 참여했습니다`, '회원으로 등록되었습니다. 수강권은 스튜디오에서 발급해 드립니다.');
        onDone?.(studio);
      })
      .catch((error: Error) => showDialog('참여할 수 없습니다', error.message));
  };

  const onCreate = () => {
    if (!canCreate) return;
    createStudio
      .mutateAsync(name.trim())
      .then((studio) => {
        showDialog(
          `${studio.name}을(를) 만들었습니다`,
          `원장으로 등록되었습니다.\n\n초대 코드: ${studio.invite_code}\n회원과 강사에게 이 코드를 알려주세요. '내 정보'에서 언제든 다시 볼 수 있습니다.`,
        );
        onDone?.(studio);
      })
      .catch((error: Error) => showDialog('만들 수 없습니다', error.message));
  };

  const fieldClass = 'rounded-2xl border border-stone-200 bg-white px-4 py-4 text-[16px] text-ink';

  return (
    <KeyboardAvoidingView className="flex-1 bg-canvas" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }}>
        {mode === 'add' ? (
          <Pressable
            onPress={onClose}
            accessibilityLabel="닫기"
            className="-ml-2 h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
            <Ionicons name="close" size={24} color="#1B1F1E" />
          </Pressable>
        ) : null}

        <Text className="mt-4 text-3xl font-bold text-ink">
          {mode === 'first' ? `${profile?.name || ''}님, 환영합니다` : '스튜디오 추가'}
        </Text>
        <Text className="mt-2 text-base text-stone-500">
          {mode === 'first'
            ? '다니는 곳의 초대 코드를 입력하거나, 직접 운영한다면 새로 만드세요.'
            : '다른 스튜디오에 참여하거나 새로 만들 수 있습니다.'}
        </Text>

        {/* ── 초대 코드로 참여 ── */}
        <View className="mt-8 rounded-3xl bg-white p-5">
          <View className="flex-row items-center">
            <Ionicons name="enter-outline" size={20} color="#24766A" />
            <Text className="ml-2 text-lg font-bold text-ink">초대 코드로 참여</Text>
          </View>
          <Text className="mt-1 text-sm text-stone-500">회원·강사 모두 코드로 들어옵니다. 강사는 원장이 역할을 바꿔 줍니다.</Text>
          <TextInput
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="예: 7K3QXA"
            placeholderTextColor="#A8A29E"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            returnKeyType="go"
            onSubmitEditing={onJoin}
            className={`mt-4 text-center text-xl font-bold tracking-[6px] ${fieldClass}`}
          />
          <Pressable
            onPress={onJoin}
            disabled={!canJoin}
            className={`mt-3 items-center rounded-2xl py-4 active:opacity-80 ${canJoin ? 'bg-brand-600' : 'bg-brand-200'}`}>
            {joinStudio.isPending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="text-base font-bold text-white">참여하기</Text>
            )}
          </Pressable>
        </View>

        <View className="my-6 flex-row items-center">
          <View className="h-px flex-1 bg-stone-300" />
          <Text className="mx-3 text-sm text-stone-400">또는</Text>
          <View className="h-px flex-1 bg-stone-300" />
        </View>

        {/* ── 새로 만들기 ── */}
        <View className="rounded-3xl bg-white p-5">
          <View className="flex-row items-center">
            <Ionicons name="add-circle-outline" size={20} color="#24766A" />
            <Text className="ml-2 text-lg font-bold text-ink">새 스튜디오 만들기</Text>
          </View>
          <Text className="mt-1 text-sm text-stone-500">
            원장으로 시작합니다. 1:1 과외 선생님이라면 &apos;김선생 수학교실&apos;처럼 이름을 정하세요.
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="스튜디오 이름"
            placeholderTextColor="#A8A29E"
            maxLength={40}
            returnKeyType="done"
            onSubmitEditing={onCreate}
            className={`mt-4 ${fieldClass}`}
          />
          <Pressable
            onPress={onCreate}
            disabled={!canCreate}
            className={`mt-3 items-center rounded-2xl border-2 py-3.5 active:opacity-80 ${
              canCreate ? 'border-brand-600' : 'border-brand-200'
            }`}>
            {createStudio.isPending ? (
              <ActivityIndicator color="#24766A" />
            ) : (
              <Text className={`text-base font-bold ${canCreate ? 'text-brand-700' : 'text-brand-200'}`}>만들기</Text>
            )}
          </Pressable>
        </View>

        {mode === 'first' ? (
          <Pressable onPress={() => void signOut()} className="mt-8 items-center py-2">
            <Text className="text-sm font-semibold text-stone-500">로그아웃</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
