import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { supabase } from './supabase';

/**
 * 휴대폰 푸시 등록.
 * - 웹·시뮬레이터: 푸시 없음(알림함은 그대로 동작)
 * - Android Expo Go(SDK 53+): 원격 푸시 미지원 → 개발 빌드 필요
 * - EAS projectId 가 없으면(`npx eas init` 전) 등록하지 않는다
 */
export type PushStatus = 'idle' | 'registered' | 'unsupported' | 'denied' | 'no-project' | 'error';

interface PushState {
  status: PushStatus;
  token: string | null;
  reason: string | null;
}
export const usePushStore = create<PushState>(() => ({ status: 'idle', token: null, reason: null }));
const set = (s: Partial<PushState>) => usePushStore.setState(s);

if (Platform.OS !== 'web') {
  // 앱을 보고 있을 때 온 알림도 배너로 보여준다
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

export const PUSH_STATUS_TEXT: Record<PushStatus, string> = {
  idle: '알림 설정을 확인하는 중입니다.',
  registered: '이 기기로 알림을 받습니다.',
  unsupported: '이 기기(웹·시뮬레이터)에서는 휴대폰 알림을 받을 수 없어요. 알림은 여기에서 확인하세요.',
  denied: '휴대폰 설정에서 이 앱의 알림을 허용하면 바로 받을 수 있어요.',
  'no-project': '휴대폰 알림 설정이 아직 끝나지 않았어요(관리자 설정 필요). 알림은 여기에서 확인할 수 있어요.',
  error: '알림 등록에 실패했어요. 앱을 다시 열면 다시 시도합니다.',
};

export async function registerForPush(): Promise<PushStatus> {
  try {
    if (Platform.OS === 'web' || !Device.isDevice) {
      set({ status: 'unsupported', reason: null });
      return 'unsupported';
    }
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: '예약 알림',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) {
      set({ status: 'denied', reason: null });
      return 'denied';
    }
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      set({ status: 'no-project', reason: 'app.json 에 extra.eas.projectId 가 없습니다. `npx eas init` 을 실행하세요.' });
      return 'no-project';
    }
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
    if (error) throw new Error(error.message);
    set({ status: 'registered', token, reason: null });
    return 'registered';
  } catch (e) {
    set({ status: 'error', reason: e instanceof Error ? e.message : String(e) });
    return 'error';
  }
}

/** 로그아웃 직전: 이 기기 토큰을 지워 다른 사람 알림이 오지 않게 */
export async function unregisterPush(): Promise<void> {
  const token = usePushStore.getState().token;
  if (!token) return;
  await supabase.rpc('unregister_push_token', { p_token: token });
  set({ status: 'idle', token: null });
}

/** 알림을 눌렀을 때 이동할 앱 경로 */
export function pathFromNotification(data: unknown): string | null {
  const path = (data as { path?: unknown } | null)?.path;
  return typeof path === 'string' && path.startsWith('/') ? path : null;
}
