import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { BRAND, EmptyView, ErrorView, LoadingView, Screen } from '@/components/ui';
import { usePassProducts } from '@/hooks/queries';
import { useStudio } from '@/hooks/useStudio';
import { formatWon } from '@/lib/labels';
import { durationLabel, type PassProduct } from '@/lib/products';

/** 수강권 상품(가격표) 목록 — 원장·관리자. 발급 화면에서 골라 쓰는 상품들 */
export default function PassProductsScreen() {
  const router = useRouter();
  const { studioId, studio, isAdmin } = useStudio();
  const query = usePassProducts(studioId, isAdmin);
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/profile'));
  const open = (id?: string) => router.push(id ? { pathname: '/(admin)/products/edit', params: { id } } : '/(admin)/products/edit');

  const active = (query.data ?? []).filter((p) => p.is_active);
  const hidden = (query.data ?? []).filter((p) => !p.is_active);

  const body = () => {
    if (!isAdmin) return <EmptyView icon="lock-closed-outline" title="원장 또는 관리자만 볼 수 있습니다" />;
    if (query.isLoading) return <LoadingView />;
    if (query.isError) return <ErrorView message={query.error.message} onRetry={() => void query.refetch()} />;
    return (
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={BRAND} />}>
        <Text className="mt-1 text-sm leading-5 text-stone-500">
          여기 등록한 상품은 수강권 발급 화면 맨 위에 나타나고, 고르면 유형·횟수·기간·금액이 자동으로 채워집니다. 이미 발급한 수강권에는
          영향이 없습니다.
        </Text>

        {active.length === 0 ? (
          <View className="mt-4">
            <EmptyView icon="pricetags-outline" title="등록된 상품이 없습니다" description="오른쪽 위 '추가'로 스튜디오 상품을 등록하세요. 예: 그룹 20회 · 3개월 · 480,000원" />
          </View>
        ) : (
          <View className="mt-4 rounded-2xl bg-white px-4">
            {active.map((p, i) => (
              <ProductRow key={p.id} product={p} first={i === 0} onPress={() => open(p.id)} />
            ))}
          </View>
        )}

        {hidden.length > 0 ? (
          <>
            <Text className="mb-2 mt-6 text-sm font-semibold text-stone-600">숨긴 상품 {hidden.length}개</Text>
            <View className="rounded-2xl bg-white px-4 opacity-70">
              {hidden.map((p, i) => (
                <ProductRow key={p.id} product={p} first={i === 0} onPress={() => open(p.id)} />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    );
  };

  return (
    <Screen>
      <View className="flex-row items-center px-3 py-2">
        <Pressable onPress={goBack} accessibilityLabel="뒤로" className="h-10 w-10 items-center justify-center rounded-full active:bg-stone-200">
          <Ionicons name="chevron-back" size={24} color="#1B1F1E" />
        </Pressable>
        <Text className="ml-1 flex-1 text-lg font-bold text-ink" numberOfLines={1}>
          수강권 상품 · {studio?.name}
        </Text>
        {isAdmin ? (
          <Pressable
            onPress={() => open()}
            accessibilityRole="button"
            accessibilityLabel="상품 추가"
            className="flex-row items-center rounded-full bg-brand-600 px-3 py-1.5 active:opacity-80">
            <Ionicons name="add" size={16} color="#FFFFFF" />
            <Text className="ml-0.5 text-sm font-bold text-white">추가</Text>
          </Pressable>
        ) : null}
      </View>
      {body()}
    </Screen>
  );
}

function ProductRow({ product: p, first, onPress }: { product: PassProduct; first: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" className={`flex-row items-center py-3.5 active:opacity-60 ${first ? '' : 'border-t border-stone-100'}`}>
      <View className={`mr-3 rounded-full px-2 py-0.5 ${p.class_type === 'private' ? 'bg-brand-700' : 'bg-brand-50'}`}>
        <Text className={`text-[11px] font-bold ${p.class_type === 'private' ? 'text-white' : 'text-brand-700'}`}>
          {p.class_type === 'private' ? '1:1' : '그룹'}
        </Text>
      </View>
      <View className="flex-1 pr-2">
        <Text className="text-base font-semibold text-ink" numberOfLines={1}>
          {p.name}
          {p.is_active ? '' : ' (숨김)'}
        </Text>
        <Text className="mt-0.5 text-xs text-stone-500">
          {p.total_count}회 · {durationLabel(p.duration_value, p.duration_unit)}
        </Text>
      </View>
      <Text className="text-sm font-bold text-ink">{p.price === null ? '가격 미정' : formatWon(p.price)}</Text>
      <Ionicons name="chevron-forward" size={18} color="#A8A29E" style={{ marginLeft: 6 }} />
    </Pressable>
  );
}
