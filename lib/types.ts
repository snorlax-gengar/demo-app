/** 스튜디오별 역할. owner = 원장(사장), manager = 관리자 */
export type Role = 'owner' | 'manager' | 'instructor' | 'member';
export type ClassType = 'private' | 'group';
export type BookingStatus = 'confirmed' | 'waitlist' | 'cancelled' | 'attended' | 'no_show';

/** 로그인 계정 프로필. 역할은 스튜디오마다 다르므로 여기 없다 */
export interface UserProfile {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  created_at: string;
  withdrawn_at?: string | null;
}

export interface Studio {
  id: string;
  name: string;
  invite_code: string;
  created_by: string | null;
  created_at: string;
}

/** 내가 속한 스튜디오 1곳 (+ 그곳에서의 내 역할) */
export interface Membership {
  studio_id: string;
  role: Role;
  status: 'active' | 'left';
  memo: string | null;
  joined_at: string;
  studio: Studio;
}

/** 스튜디오 명단의 한 사람: 프로필 + 이 스튜디오에서의 역할·메모 */
export type StudioPerson = UserProfile & { role: Role; memo: string | null; joined_at: string };

export interface Pass {
  id: string;
  studio_id: string;
  member_id: string;
  class_type: ClassType;
  name: string;
  total_count: number;
  remaining_count: number;
  starts_on: string;
  expires_on: string;
  is_active: boolean;
  created_at: string;
}

/** 잔여 횟수 요약에 필요한 최소 수강권 필드 */
export type PassLite = Pick<Pass, 'class_type' | 'remaining_count' | 'total_count' | 'expires_on' | 'starts_on' | 'is_active'>;

export type MemberWithPasses = StudioPerson & { passes: Pass[] };

/** class_overview 뷰 한 행: 수업 + 예약/대기 인원 + 내 예약 상태 */
export interface ClassOverview {
  id: string;
  studio_id: string;
  title: string;
  instructor_id: string;
  instructor_name: string;
  starts_at: string;
  ends_at: string;
  max_capacity: number;
  class_type: ClassType;
  status: 'scheduled' | 'cancelled';
  location: string | null;
  confirmed_count: number;
  waitlist_count: number;
  my_booking_id: string | null;
  my_booking_status: Exclude<BookingStatus, 'cancelled'> | null;
  my_waitlist_position: number | null;
}

export interface Booking {
  id: string;
  class_id: string;
  member_id: string;
  pass_id: string | null;
  status: BookingStatus;
  pass_refunded: boolean;
  promoted_at: string | null;
  cancelled_at: string | null;
  created_at: string;
}

/** 강사/원장 타임라인용: 수업 + 예약자 명단 */
export interface TimelineBooking {
  id: string;
  status: BookingStatus;
  created_at: string;
  /** passes: 출석부에서 회원별 잔여 횟수를 바로 보여주기 위해 함께 조회 */
  member: (Pick<UserProfile, 'id' | 'name'> & { passes?: (PassLite & { studio_id: string })[] }) | null;
}

export interface TimelineClass {
  id: string;
  studio_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  max_capacity: number;
  class_type: ClassType;
  location: string | null;
  instructor_id: string;
  status: 'scheduled' | 'cancelled';
  instructor: Pick<UserProfile, 'id' | 'name'> | null;
  bookings: TimelineBooking[];
}

/** 회원 상세용: 예약 + 수업 정보 */
export interface MemberBooking {
  id: string;
  status: BookingStatus;
  /** null 이면 수강권이 차감된 적 없는 예약(대기) */
  pass_id: string | null;
  pass_refunded: boolean;
  promoted_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  class: {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string;
    max_capacity: number;
    class_type: ClassType;
    instructor_id: string;
    instructor: { name: string } | null;
  } | null;
}

export interface MemberDetail {
  profile: StudioPerson;
  passes: Pass[];
  bookings: MemberBooking[];
}

/** 수업 등록 시 INSERT 하는 값 */
export interface NewClassInput {
  studio_id: string;
  title: string;
  instructor_id: string;
  starts_at: string;
  ends_at: string;
  max_capacity: number;
  location: string | null;
}

export type PassLogReason =
  | 'issued'
  | 'booking'
  | 'waitlist_promotion'
  | 'cancel_refund'
  | 'class_cancelled'
  | 'admin_adjust'
  | 'extended'
  | 'deactivated'
  | 'reactivated';

/** 수강권 변동 내역 한 줄 */
export interface PassLog {
  id: number;
  delta: number;
  remaining_after: number;
  reason: PassLogReason;
  memo: string | null;
  created_at: string;
  actor: { name: string } | null;
}

export type PaymentMethod = 'card' | 'cash' | 'transfer' | 'other';

/** 결제 기록 (원장만 조회 가능) */
export interface PassPayment {
  id: string;
  amount: number;
  method: PaymentMethod;
  paid_on: string;
  memo: string | null;
}

export interface PassDetail {
  pass: Pass & { member: { id: string; name: string } | null };
  logs: PassLog[];
  /** 원장이 아니면 항상 빈 배열 (DB 가 막음) */
  payments: PassPayment[];
}

export interface IssuePassInput {
  studioId: string;
  memberId: string;
  classType: ClassType;
  name: string;
  total: number;
  startsOn: string;
  expiresOn: string;
  amount: number | null;
  method: PaymentMethod | null;
  memo: string | null;
}
