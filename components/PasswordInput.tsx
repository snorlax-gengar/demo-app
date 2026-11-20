import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';

/**
 * 비밀번호 입력칸 + 오른쪽 눈 모양 버튼(보기/숨기기).
 * className 은 입력칸 자체의 스타일(테두리·여백). 버튼 자리만큼 오른쪽 여백을 더한다.
 */
export function PasswordInput({ className = '', ...props }: Omit<TextInputProps, 'secureTextEntry'> & { className?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <View className="relative justify-center">
      <TextInput
        {...props}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        className={`${className} pr-14`}
      />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={visible ? '비밀번호 숨기기' : '비밀번호 보기'}
        hitSlop={8}
        className="absolute right-2 h-11 w-11 items-center justify-center rounded-full active:bg-stone-100">
        <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={22} color="#78716C" />
      </Pressable>
    </View>
  );
}
