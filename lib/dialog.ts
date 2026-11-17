import { Alert, Platform, type AlertButton } from 'react-native';
import { create } from 'zustand';

/**
 * Alert.alert 의 크로스플랫폼 버전.
 * - 휴대폰(iOS/Android): Alert.alert 그대로.
 * - 웹: 앱 안의 모달(components/DialogHost)로 띄운다.
 *   react-native-web 의 Alert.alert 는 아무것도 하지 않고, 브라우저 기본 confirm/alert 는
 *   브라우저 설정·내장 브라우저에 따라 차단되면 조용히 false 를 돌려줘 로그아웃 같은 동작이 실행되지 않는다.
 */
export interface DialogRequest {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
}

interface DialogState {
  queue: DialogRequest[];
  push: (d: Omit<DialogRequest, 'id'>) => void;
  /** 맨 앞 창을 닫고, 눌린 버튼이 있으면 그 onPress 를 실행 */
  resolve: (button?: AlertButton) => void;
}

let nextId = 1;

export const useDialogStore = create<DialogState>((set, get) => ({
  queue: [],
  push: (d) => set({ queue: [...get().queue, { ...d, id: nextId++ }] }),
  resolve: (button) => {
    set({ queue: get().queue.slice(1) });
    button?.onPress?.();
  },
}));

export function showDialog(title: string, message?: string, buttons?: AlertButton[]) {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons);
    return;
  }
  useDialogStore.getState().push({
    title,
    message,
    buttons: buttons && buttons.length > 0 ? buttons : [{ text: '확인' }],
  });
}
