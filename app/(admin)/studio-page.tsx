import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Share, Switch, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Field } from '@/components/form';
import { ErrorView, LoadingView, Screen } from '@/components/ui';
import { useSaveStudioPage, useStudioPage } from '@/hooks/queries';
import { useStudio } from '@/hooks/useStudio';
import { showDialog } from '@/lib/dialog';
import {
  MAX_PHOTOS,
  SLUG_RE,
  cleanSlug,
  photoUrl,
  publicPageUrl,
  removeStudioPhotos,
  uploadStudioPhoto,
  type StudioPageInput,
} from '@/lib/studioPage';

const input = 'rounded-2xl border border-stone-200 bg-white px-4 py-3.5 text-[16px] text-ink';

/**
 * 스튜디오 소개 페이지 편집 (원장·실장). 공개하면 piq.expo.app/s/<주소 이름> 에서 누구나 볼 수 있고,
 * 링크를 카카오톡·인스타에 공유하면 대표 사진·한 줄 소개가 미리보기로 뜬다. 체험 신청은 '체험 신청' 화면으로 들어온다.
 */
export default function StudioPageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { studioId, studio, isAdmin } = useStudio();
  const pageQuery = useStudioPage(studioId, isAdmin);
  const save = useSaveStudioPage();

  const [form, setForm] = useState<StudioPageInput | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);

  useEffect(() => {
    if (form || pageQuery.isLoading || pageQuery.isError) return;
    const p = pageQuery.data;
    setForm({
      slug: p?.slug ?? cleanSlug(`studio-${studio?.invite_code ?? ''}`),
      published: p?.published ?? false,
      headline: p?.headline ?? '',
      intro: p?.intro ?? '',
      category: p?.category ?? '',
      address: p?.address ?? '',
      contact_phone: p?.contact_phone ?? '',
      kakao_url: p?.kakao_url ?? '',
      instagram: p?.instagram ?? '',
      website_url: p?.website_url ?? '',
      hours: p?.hours ?? '',
      show_schedule: p?.show_schedule ?? true,
      trial_enabled: p?.trial_enabled ?? true,
      trial_note: p?.trial_note ?? '',
      photos: p?.photos ?? [],
    });
  }, [form, pageQuery.isLoading, pageQuery.isError, pageQuery.data, studio?.invite_code]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  const header = (
    <View className="flex-row items-center px-3 py-2">
      <Pressable onPress={close} accessibilityLabel="뒤로" className="h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
        <Ionicons name="chevron-back" size={24} color="#2F3842" />
      </Pressable>
      <Text className="ml-1 flex-1 text-lg font-bold text-ink">소개 페이지</Text>
    </View>
  );

  if (!isAdmin) {
    return (
      <Screen>
        {header}
        <ErrorView message="원장·실장만 소개 페이지를 고칠 수 있습니다." onRetry={close} />
      </Screen>
    );
  }
  if (pageQuery.isError) {
    return (
      <Screen>
        {header}
        <ErrorView message={pageQuery.error.message} onRetry={() => void pageQuery.refetch()} />
      </Screen>
    );
  }
  if (!form) {
    return (
      <Screen>
        {header}
        <LoadingView />
      </Screen>
    );
  }

  const set = <K extends keyof StudioPageInput>(key: K, value: StudioPageInput[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const saved = pageQuery.data;
  const url = publicPageUrl(saved?.slug ?? form.slug);
  const livePublished = !!saved?.published;

  const pickPhotos = async () => {
    const room = MAX_PHOTOS - form.photos.length;
    if (room <= 0) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted && Platform.OS !== 'web') {
      showDialog('사진 접근 권한이 필요해요', '휴대폰 설정에서 PIQ 의 사진 접근을 허용해 주세요.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: room, quality: 1 });
    if (res.canceled) return;
    const assets = res.assets.slice(0, room);
    setUploading(assets.length);
    try {
      for (const a of assets) {
        const path = await uploadStudioPhoto(studioId, a.uri);
        setForm((f) => (f ? { ...f, photos: [...f.photos, path].slice(0, MAX_PHOTOS) } : f));
        setUploading((n) => n - 1);
      }
    } catch (e) {
      showDialog('사진을 올리지 못했어요', e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(0);
    }
  };

  const removePhoto = (path: string) => {
    set('photos', form.photos.filter((p) => p !== path));
    if (saved?.photos.includes(path)) setRemoved((r) => [...r, path]);
    else void removeStudioPhotos([path]); // 아직 저장 전에 올린 사진은 바로 지움
  };
  const makeCover = (path: string) => set('photos', [path, ...form.photos.filter((p) => p !== path)]);

  const problem = (): string | null => {
    if (!SLUG_RE.test(form.slug) || form.slug.includes('--')) return '주소 이름은 영어 소문자·숫자·하이픈(-)으로 3~30자예요. (예: pilates-namu)';
    if (form.kakao_url && !/^https:\/\/(open\.kakao\.com|pf\.kakao\.com)\//.test(form.kakao_url.trim()))
      return '카카오톡 링크는 https://open.kakao.com/… 또는 https://pf.kakao.com/… 형태로 넣어 주세요.';
    if (form.website_url && !/^https:\/\//.test(form.website_url.trim())) return '웹사이트 주소는 https:// 로 시작해야 해요.';
    if (form.instagram && !/^@?[A-Za-z0-9._]{1,30}$/.test(form.instagram.trim())) return '인스타그램은 아이디만 적어 주세요. (예: pilates.namu)';
    if (form.contact_phone && !/^[0-9+\- ()]{0,20}$/.test(form.contact_phone.trim())) return '전화번호는 숫자와 - 만 써 주세요.';
    if (form.published && !form.headline?.trim()) return '공개하려면 한 줄 소개를 적어 주세요. 링크 미리보기에 나와요.';
    return null;
  };

  const submit = () => {
    const p = problem();
    if (p) {
      showDialog('저장할 수 없습니다', p);
      return;
    }
    save.mutate(
      { studioId, page: form },
      {
        onSuccess: (row) => {
          void removeStudioPhotos(removed);
          setRemoved([]);
          showDialog(
            row.published ? '저장했어요 · 공개 중' : '저장했어요 · 비공개',
            row.published ? `누구나 이 주소에서 볼 수 있어요.\n${publicPageUrl(row.slug)}` : '공개를 켜고 저장하면 링크로 볼 수 있어요.',
          );
        },
        onError: (e) => showDialog('저장할 수 없습니다', e.message),
      },
    );
  };

  const share = async () => {
    const message = `${studio?.name ?? ''} 소개 · 체험 신청\n${url}`;
    try {
      await Share.share({ message });
    } catch {
      showDialog('소개 페이지 링크', url);
    }
  };

  const toggle = (label: string, sub: string, value: boolean, onChange: (v: boolean) => void) => (
    <View className="mt-3 flex-row items-center rounded-2xl bg-surface px-4 py-3">
      <View className="flex-1 pr-3">
        <Text className="text-base text-ink">{label}</Text>
        <Text className="mt-0.5 text-xs text-stone-500">{sub}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} trackColor={{ true: '#0B7A4D', false: '#D6D3D1' }} thumbColor="#FFFFFF" />
    </View>
  );

  return (
    <Screen>
      {header}
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
          {/* 공개 상태 · 링크 */}
          <View className={`rounded-3xl p-5 ${livePublished ? 'bg-brand-700' : 'bg-surface'}`}>
            <Text className={`text-sm font-semibold ${livePublished ? 'text-brand-100' : 'text-stone-500'}`}>
              {livePublished ? '공개 중' : saved ? '비공개' : '아직 만들지 않았어요'}
            </Text>
            <Text selectable accessibilityLabel="소개 페이지 주소" className={`mt-1 text-base font-bold ${livePublished ? 'text-white' : 'text-ink'}`}>
              {url.replace('https://', '')}
            </Text>
            {livePublished ? (
              <View className="mt-4 flex-row gap-2">
                <Pressable onPress={share} accessibilityRole="button" accessibilityLabel="링크 공유" className="flex-1 flex-row items-center justify-center rounded-2xl bg-white/95 py-3 active:opacity-80">
                  <Ionicons name="share-outline" size={18} color="#0B6E46" />
                  <Text className="ml-1.5 text-sm font-bold text-brand-700">링크 공유</Text>
                </Pressable>
                <Pressable onPress={() => void Linking.openURL(url)} accessibilityRole="link" accessibilityLabel="페이지 열기" className="flex-1 flex-row items-center justify-center rounded-2xl border border-white/60 py-3 active:opacity-80">
                  <Ionicons name="open-outline" size={18} color="#FFFFFF" />
                  <Text className="ml-1.5 text-sm font-bold text-white">페이지 열기</Text>
                </Pressable>
              </View>
            ) : (
              <Text className="mt-2 text-xs leading-5 text-stone-500">아래 내용을 채우고 "공개"를 켠 뒤 저장하면, 이 주소를 카카오톡·인스타그램 등에 공유할 수 있어요.</Text>
            )}
          </View>

          {toggle('공개', '켜면 링크를 아는 누구나 볼 수 있어요. 회원 이름·초대 코드는 나오지 않아요.', form.published, (v) => set('published', v))}

          <Field label="주소 이름">
            <View className="flex-row items-center rounded-2xl border border-stone-200 bg-white px-4">
              <Text className="text-[15px] text-stone-400">piq.expo.app/s/</Text>
              <TextInput
                value={form.slug}
                onChangeText={(t) => set('slug', cleanSlug(t))}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="pilates-namu"
                placeholderTextColor="#A8A29E"
                accessibilityLabel="주소 이름"
                className="flex-1 py-3.5 text-[16px] text-ink"
              />
            </View>
            <Text className="mt-2 text-xs text-stone-400">영어 소문자·숫자·하이픈(-) 3~30자. 바꾸면 예전 링크는 열리지 않아요.</Text>
          </Field>

          <Field label={`사진 (${form.photos.length}/${MAX_PHOTOS}) · 첫 장이 대표 사진`}>
            <View className="flex-row flex-wrap gap-2">
              {form.photos.map((path, i) => (
                <View key={path} className="h-24 w-24 overflow-hidden rounded-2xl bg-surface">
                  <Image source={{ uri: photoUrl(path) }} style={{ width: 96, height: 96 }} accessibilityLabel={i === 0 ? '대표 사진' : `사진 ${i + 1}`} />
                  {i === 0 ? (
                    <View className="absolute bottom-1 left-1 rounded-full bg-black/60 px-2 py-0.5">
                      <Text className="text-[11px] font-bold text-white">대표</Text>
                    </View>
                  ) : (
                    <Pressable onPress={() => makeCover(path)} accessibilityLabel={`사진 ${i + 1} 대표로`} className="absolute bottom-1 left-1 rounded-full bg-black/45 px-2 py-0.5">
                      <Text className="text-[11px] text-white">대표로</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={() => removePhoto(path)} accessibilityLabel={`사진 ${i + 1} 지우기`} hitSlop={6} className="absolute right-1 top-1 h-6 w-6 items-center justify-center rounded-full bg-black/60">
                    <Ionicons name="close" size={14} color="#FFFFFF" />
                  </Pressable>
                </View>
              ))}
              {uploading > 0 ? (
                <View className="h-24 w-24 items-center justify-center rounded-2xl bg-surface">
                  <ActivityIndicator color="#0B7A4D" />
                </View>
              ) : null}
              {form.photos.length < MAX_PHOTOS && uploading === 0 ? (
                <Pressable onPress={pickPhotos} accessibilityRole="button" accessibilityLabel="사진 추가" className="h-24 w-24 items-center justify-center rounded-2xl border-2 border-dashed border-stone-300 active:bg-stone-100">
                  <Ionicons name="add" size={26} color="#78716C" />
                  <Text className="text-xs text-stone-500">사진 추가</Text>
                </Pressable>
              ) : null}
            </View>
          </Field>

          <Field label="한 줄 소개 (링크 미리보기에 나와요)">
            <TextInput value={form.headline ?? ''} onChangeText={(t) => set('headline', t)} maxLength={60} placeholder="예: 6명 이하 소그룹 기구 필라테스" placeholderTextColor="#A8A29E" accessibilityLabel="한 줄 소개" className={input} />
          </Field>
          <Field label="종목">
            <TextInput value={form.category ?? ''} onChangeText={(t) => set('category', t)} maxLength={30} placeholder="예: 필라테스, 요가, 수학 학원" placeholderTextColor="#A8A29E" accessibilityLabel="종목" className={input} />
          </Field>
          <Field label="소개글">
            <TextInput
              value={form.intro ?? ''}
              onChangeText={(t) => set('intro', t)}
              maxLength={2000}
              multiline
              textAlignVertical="top"
              placeholder="강사 소개, 수업 방식, 시설, 처음 오시는 분께 드리는 안내 등"
              placeholderTextColor="#A8A29E"
              accessibilityLabel="소개글"
              className={`${input} min-h-[140px]`}
            />
          </Field>

          <Field label="위치·연락">
            <View className="gap-2">
              <TextInput value={form.address ?? ''} onChangeText={(t) => set('address', t)} maxLength={200} placeholder="주소 (지도 링크로 연결돼요)" placeholderTextColor="#A8A29E" accessibilityLabel="주소" className={input} />
              <TextInput value={form.contact_phone ?? ''} onChangeText={(t) => set('contact_phone', t)} maxLength={20} keyboardType="phone-pad" placeholder="전화번호 (선택)" placeholderTextColor="#A8A29E" accessibilityLabel="전화번호" className={input} />
              <TextInput value={form.kakao_url ?? ''} onChangeText={(t) => set('kakao_url', t.trim())} autoCapitalize="none" placeholder="카카오톡 채널·오픈채팅 링크 (선택)" placeholderTextColor="#A8A29E" accessibilityLabel="카카오톡 링크" className={input} />
              <TextInput value={form.instagram ?? ''} onChangeText={(t) => set('instagram', t.trim())} autoCapitalize="none" placeholder="인스타그램 아이디 (선택)" placeholderTextColor="#A8A29E" accessibilityLabel="인스타그램 아이디" className={input} />
              <TextInput value={form.website_url ?? ''} onChangeText={(t) => set('website_url', t.trim())} autoCapitalize="none" placeholder="웹사이트·블로그 https:// (선택)" placeholderTextColor="#A8A29E" accessibilityLabel="웹사이트" className={input} />
            </View>
          </Field>
          <Field label="운영 시간">
            <TextInput value={form.hours ?? ''} onChangeText={(t) => set('hours', t)} maxLength={500} multiline textAlignVertical="top" placeholder={'예: 평일 07:00~22:00\n토 09:00~14:00 · 일 휴무'} placeholderTextColor="#A8A29E" accessibilityLabel="운영 시간" className={`${input} min-h-[80px]`} />
          </Field>

          <Field label="페이지에 보여줄 것">
            {toggle('시간표', '앞으로 2주 수업 시간과 남은 자리만 보여요 (예약자·강사 이름은 안 보여요)', form.show_schedule, (v) => set('show_schedule', v))}
            {toggle('체험 수업 신청 받기', '이름·연락처를 남기면 원장·실장에게 알림이 와요', form.trial_enabled, (v) => set('trial_enabled', v))}
          </Field>
          {form.trial_enabled ? (
            <Field label="체험 안내 (선택)">
              <TextInput value={form.trial_note ?? ''} onChangeText={(t) => set('trial_note', t)} maxLength={300} multiline textAlignVertical="top" placeholder="예: 체험 1회 2만원 · 편한 운동복 준비" placeholderTextColor="#A8A29E" accessibilityLabel="체험 안내" className={`${input} min-h-[70px]`} />
            </Field>
          ) : null}
        </ScrollView>

        <View className="border-t border-stone-200 bg-white px-5 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
          <Pressable onPress={submit} disabled={save.isPending || uploading > 0} accessibilityRole="button" accessibilityLabel="소개 페이지 저장" className="items-center rounded-2xl bg-brand-600 py-4 active:opacity-80">
            {save.isPending ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-base font-bold text-white">{form.published ? '저장하고 공개' : '저장 (비공개)'}</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
