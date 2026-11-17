import { StudioSetup } from '@/components/StudioSetup';

/** 가입 직후 소속 스튜디오가 없을 때. 성공하면 루트 레이아웃이 역할에 맞는 화면으로 자동 전환한다 */
export default function OnboardingScreen() {
  return <StudioSetup mode="first" />;
}
