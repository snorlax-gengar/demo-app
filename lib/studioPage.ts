import * as ImageManipulator from 'expo-image-manipulator';

import { LEGAL_INFO } from '@/lib/legal';
import { supabase } from '@/lib/supabase';

/** 소개 페이지 (패치 016 studio_pages) */
export interface StudioPage {
  studio_id: string;
  slug: string;
  published: boolean;
  headline: string | null;
  intro: string | null;
  category: string | null;
  address: string | null;
  contact_phone: string | null;
  kakao_url: string | null;
  instagram: string | null;
  website_url: string | null;
  hours: string | null;
  show_schedule: boolean;
  trial_enabled: boolean;
  trial_note: string | null;
  photos: string[];
  updated_at: string;
}

export type StudioPageInput = Omit<StudioPage, 'studio_id' | 'updated_at'>;

export type TrialStatus = 'new' | 'contacted' | 'scheduled' | 'done' | 'declined';

export interface TrialRequest {
  id: string;
  studio_id: string;
  name: string;
  phone: string;
  preferred: string | null;
  message: string | null;
  status: TrialStatus;
  memo: string | null;
  handled_at: string | null;
  created_at: string;
}

export const TRIAL_STATUS_LABEL: Record<TrialStatus, string> = {
  new: '새 신청',
  contacted: '연락함',
  scheduled: '체험 예약',
  done: '완료',
  declined: '진행 안 함',
};

export const PHOTO_BUCKET = 'studio-photos';
export const MAX_PHOTOS = 6;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

export const publicPageUrl = (slug: string) => `${LEGAL_INFO.siteUrl}/s/${slug}`;

export const photoUrl = (path: string) => supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;

/** 주소 이름 입력 정리: 소문자·숫자·하이픈만, 하이픈 연속 금지 */
export const cleanSlug = (raw: string) =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 30);

/** 화면에 보일 전화번호 (01012345678 → 010-1234-5678) */
export const formatPhone = (digits: string) => {
  const d = digits.replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return d.startsWith('02') ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
  return digits;
};

/** 고른 사진을 긴 변 1600px JPEG 로 줄여 studio-photos/<studioId>/ 에 올리고 경로를 돌려준다 */
export async function uploadStudioPhoto(studioId: string, uri: string): Promise<string> {
  const resized = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1600 } }], {
    compress: 0.8,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  const body = await (await fetch(resized.uri)).arrayBuffer();
  const path = `${studioId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, body, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(`사진을 올리지 못했어요: ${error.message}`);
  return path;
}

/** 지운 사진 파일 정리 (실패해도 페이지 저장에는 영향 없음) */
export async function removeStudioPhotos(paths: string[]) {
  if (paths.length) await supabase.storage.from(PHOTO_BUCKET).remove(paths);
}
