import { useRouter } from 'expo-router';

import { StudioSetup } from '@/components/StudioSetup';

/** 이미 소속이 있는 사람이 다른 스튜디오에 참여하거나 새로 만들 때 ('내 정보'에서 진입) */
export default function AddStudioScreen() {
  const router = useRouter();
  return (
    <StudioSetup
      mode="add"
      onClose={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      // 새 스튜디오가 이미 선택된 상태 → 그 스튜디오에서의 역할에 맞는 첫 화면으로
      onDone={() => router.replace('/')}
    />
  );
}
