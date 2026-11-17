import { isAdminRole, isStaffRole } from '@/lib/labels';
import { useActiveMembership } from '@/stores/auth';

/**
 * 지금 보고 있는 스튜디오와 그곳에서의 내 권한.
 * (member)/(admin) 화면은 소속이 있을 때만 열리므로 studioId 는 항상 채워져 있다.
 */
export function useStudio() {
  const membership = useActiveMembership();
  const role = membership?.role ?? null;
  return {
    studioId: membership?.studio_id ?? '',
    studio: membership?.studio ?? null,
    role,
    /** 원장 */
    isOwner: role === 'owner',
    /** 원장·관리자: 전체 강사 보기, 수강권·역할 관리 */
    isAdmin: isAdminRole(role),
    /** 원장·관리자·강사 */
    isStaff: isStaffRole(role),
  };
}
