import { Modal, Pressable, Text, View } from 'react-native';

import { useDialogStore } from '@/lib/dialog';

/** 웹에서 showDialog 가 띄우는 앱 안 확인창. 루트 레이아웃에 한 번만 둔다 */
export function DialogHost() {
  const current = useDialogStore((s) => s.queue[0]);
  const resolve = useDialogStore((s) => s.resolve);

  if (!current) return null;

  const cancel = current.buttons.find((b) => b.style === 'cancel');
  // 바깥(배경)을 누르면: 취소 버튼이 있으면 취소, 안내창(버튼 1개)이면 그 버튼, 그 외엔 아무 것도 안 함
  const onBackdrop = () => {
    if (cancel) resolve(cancel);
    else if (current.buttons.length === 1) resolve(current.buttons[0]);
  };
  // 취소 버튼은 항상 왼쪽(맨 앞), 2개 이하면 가로 배치
  const ordered = [...current.buttons].sort((a, b) => Number(b.style === 'cancel') - Number(a.style === 'cancel'));
  const horizontal = ordered.length <= 2;

  return (
    <Modal key={current.id} visible transparent animationType="fade" onRequestClose={onBackdrop}>
      <Pressable
        onPress={onBackdrop}
        accessibilityLabel="닫기"
        className="flex-1 items-center justify-center bg-black/40 px-8">
        <Pressable
          onPress={() => {}}
          accessibilityRole="alert"
          className="w-full max-w-[340px] rounded-3xl bg-white p-6">
          <Text className="text-lg font-bold text-ink">{current.title}</Text>
          {current.message ? (
            <Text className="mt-2 text-[15px] leading-6 text-stone-600">{current.message}</Text>
          ) : null}
          <View className={`mt-6 gap-2 ${horizontal ? 'flex-row' : ''}`}>
            {ordered.map((b, i) => {
              const tone =
                b.style === 'cancel'
                  ? { box: 'bg-stone-100', text: 'text-stone-600' }
                  : b.style === 'destructive'
                    ? { box: 'bg-red-500', text: 'text-white' }
                    : { box: 'bg-brand-600', text: 'text-white' };
              return (
                <Pressable
                  key={`${b.text}-${i}`}
                  onPress={() => resolve(b)}
                  accessibilityRole="button"
                  className={`items-center rounded-2xl py-3.5 active:opacity-80 ${tone.box} ${horizontal ? 'flex-1' : ''}`}>
                  <Text className={`text-base font-semibold ${tone.text}`}>{b.text ?? '확인'}</Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
