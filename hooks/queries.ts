import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dayjs, type Dayjs } from '@/lib/date';
import type { PassProduct, PassProductInput } from '@/lib/products';
import type { RevenueRow } from '@/lib/revenue';
import type { StudioPage, StudioPageInput, TrialRequest, TrialStatus } from '@/lib/studioPage';
import { supabase } from '@/lib/supabase';
import type {
  Booking,
  IssuePassInput,
  PassDetail,
  BookingStatus,
  ClassOverview,
  MemberBooking,
  MemberDetail,
  MemberWithPasses,
  NewClassInput,
  Pass,
  PaymentMethod,
  Role,
  Studio,
  StudioPerson,
  TimelineClass,
  UserProfile,
} from '@/lib/types';
import { useAuthStore } from '@/stores/auth';

/** Supabase 오류 → 화면에 그대로 보여줄 수 있는 Error (DB 함수가 한글 메시지를 던진다) */
function toError(error: { message: string; code?: string }): Error {
  if (error.code === '23P01' || error.message.includes('classes_no_instructor_overlap')) {
    return new Error('같은 강사의 수업 시간이 겹칩니다. 시간이나 강사를 바꿔 주세요.');
  }
  return new Error(error.message);
}

/** 강사/원장 화면 공통: 수업 + 강사 + 예약자(+ 예약자의 수강권 잔여) */
const TIMELINE_SELECT = `
  id, studio_id, title, starts_at, ends_at, max_capacity, class_type, location, instructor_id, status,
  instructor:users!classes_instructor_id_fkey ( id, name ),
  bookings ( id, status, created_at,
    member:users!bookings_member_id_fkey ( id, name,
      passes!passes_member_id_fkey ( studio_id, class_type, remaining_count, total_count, expires_on, starts_on, is_active ) ) )`;

/** 취소 예약 제외 + 예약 순(=대기 순번) 정렬 + 다른 스튜디오 수강권 제외 */
function normalizeTimelineClass(cls: TimelineClass): TimelineClass {
  return {
    ...cls,
    bookings: cls.bookings
      .filter((b) => b.status !== 'cancelled')
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((b) =>
        b.member?.passes
          ? { ...b, member: { ...b.member, passes: b.member.passes.filter((p) => p.studio_id === cls.studio_id) } }
          : b,
      ),
  };
}

// ---------------------------------------------------------------------------
// 스튜디오: 만들기 / 참여 / 초대 코드 / 역할
// ---------------------------------------------------------------------------

/** 만들기·참여 후: 소속을 다시 불러오고 새 스튜디오를 '현재 스튜디오'로 */
async function afterStudioJoined(studio: Studio) {
  const { loadAccount, setActiveStudio } = useAuthStore.getState();
  await loadAccount();
  setActiveStudio(studio.id);
}

export function useCreateStudio() {
  return useMutation({
    mutationFn: async (name: string): Promise<Studio> => {
      const { data, error } = await supabase.rpc('create_studio', { p_name: name });
      if (error) throw toError(error);
      await afterStudioJoined(data as Studio);
      return data as Studio;
    },
  });
}

export function useJoinStudio() {
  return useMutation({
    mutationFn: async (code: string): Promise<Studio> => {
      const { data, error } = await supabase.rpc('join_studio', { p_code: code });
      if (error) throw toError(error);
      // 틀린 코드는 빈 결과로 온다 (서버가 틀린 횟수를 세기 위해 — patch 018)
      if (!(data as Studio | null)?.id) throw new Error('초대 코드를 찾을 수 없습니다. 다시 확인해 주세요.');
      await afterStudioJoined(data as Studio);
      return data as Studio;
    },
  });
}

export function useRegenerateInviteCode() {
  return useMutation({
    mutationFn: async (studioId: string): Promise<string> => {
      const { data, error } = await supabase.rpc('regenerate_invite_code', { p_studio_id: studioId });
      if (error) throw toError(error);
      await useAuthStore.getState().loadAccount(); // 소속 정보에 담긴 초대 코드 갱신
      return data as string;
    },
  });
}

export function useSetMemberRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { studioId: string; userId: string; role: Role }) => {
      const { error } = await supabase.rpc('set_member_role', {
        p_studio_id: vars.studioId,
        p_user_id: vars.userId,
        p_role: vars.role,
      });
      if (error) throw toError(error);
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}

/** 스튜디오 이름 변경 (원장·관리자) */
export function useUpdateStudioName() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { studioId: string; name: string }) => {
      const trimmed = vars.name.trim();
      if (!trimmed) throw new Error('스튜디오 이름을 입력해 주세요.');
      const { error } = await supabase.from('studios').update({ name: trimmed }).eq('id', vars.studioId);
      if (error) throw toError(error);
      await useAuthStore.getState().loadAccount();
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}

/** 내 프로필(이름·연락처) 수정 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { name: string; phone: string }) => {
      const userId = useAuthStore.getState().session?.user.id;
      if (!userId) throw new Error('로그인이 필요합니다.');
      const trimmedName = vars.name.trim();
      if (!trimmedName) throw new Error('이름을 입력해 주세요.');
      const trimmedPhone = vars.phone.trim() || null;
      const { error } = await supabase
        .from('users')
        .update({ name: trimmedName, phone: trimmedPhone })
        .eq('id', userId);
      if (error) throw toError(error);
      // Auth 메타데이터 이름도 함께 동기화 (실패해도 DB 저장은 이미 완료됨)
      await supabase.auth.updateUser({ data: { name: trimmedName } }).catch(() => {});
      await useAuthStore.getState().loadAccount();
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}

/** 스튜디오가 회원에게 남기는 메모 (원장·관리자) */
export function useUpdateMemberMemo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { studioId: string; userId: string; memo: string }) => {
      const { error } = await supabase
        .from('studio_members')
        .update({ memo: vars.memo.trim() || null })
        .eq('studio_id', vars.studioId)
        .eq('user_id', vars.userId);
      if (error) throw toError(error);
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}

// ---------------------------------------------------------------------------
// 회원
// ---------------------------------------------------------------------------

/** 이 스튜디오에서 내 수강권 (만료 임박 순) */
export function usePasses(studioId: string, memberId: string | undefined) {
  return useQuery({
    queryKey: ['passes', studioId, memberId],
    enabled: !!studioId && !!memberId,
    queryFn: async (): Promise<Pass[]> => {
      const { data, error } = await supabase
        .from('passes')
        .select('*')
        .eq('studio_id', studioId)
        .eq('member_id', memberId!)
        .order('expires_on', { ascending: true });
      if (error) throw toError(error);
      return (data ?? []) as Pass[];
    },
  });
}

/** 기간 내 수업 + 예약/대기 인원. instructorId 가 있으면 해당 강사 수업만 */
export function useClassRange(studioId: string, from: Dayjs, to: Dayjs, instructorId: string | null = null) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  return useQuery({
    queryKey: ['classes', 'range', studioId, fromIso, toIso, instructorId ?? 'all'],
    enabled: !!studioId,
    queryFn: async (): Promise<ClassOverview[]> => {
      let query = supabase
        .from('class_overview')
        .select('*')
        .eq('studio_id', studioId)
        .eq('status', 'scheduled')
        .gte('starts_at', fromIso)
        .lt('starts_at', toIso)
        .order('starts_at', { ascending: true });
      if (instructorId) query = query.eq('instructor_id', instructorId);
      const { data, error } = await query;
      if (error) throw toError(error);
      return (data ?? []) as ClassOverview[];
    },
  });
}

/** 회원 주간 시간표 */
export function useWeekClasses(studioId: string, weekStart: Dayjs) {
  return useClassRange(studioId, weekStart, weekStart.add(7, 'day'));
}

/** 다가오는 내 예약(확정 + 대기) */
export function useMyUpcomingClasses(studioId: string) {
  return useQuery({
    queryKey: ['classes', 'my-upcoming', studioId],
    enabled: !!studioId,
    queryFn: async (): Promise<ClassOverview[]> => {
      const { data, error } = await supabase
        .from('class_overview')
        .select('*')
        .eq('studio_id', studioId)
        .eq('status', 'scheduled')
        .in('my_booking_status', ['confirmed', 'waitlist'])
        .gte('starts_at', dayjs().toISOString())
        .order('starts_at', { ascending: true });
      if (error) throw toError(error);
      return (data ?? []) as ClassOverview[];
    },
  });
}

/** 회원 본인용: 이 스튜디오의 전체 예약·출석·노쇼·취소 이력 */
export function useMyBookingHistory(studioId: string, memberId: string | undefined) {
  return useQuery({
    queryKey: ['my-bookings', studioId, memberId],
    enabled: !!studioId && !!memberId,
    queryFn: async (): Promise<MemberBooking[]> => {
      const { data, error } = await supabase
        .from('bookings')
        .select(
          `id, status, pass_id, pass_refunded, promoted_at, cancelled_at, created_at,
           class:classes!bookings_class_id_fkey ( id, title, starts_at, ends_at, max_capacity, class_type, instructor_id )`,
        )
        .eq('studio_id', studioId)
        .eq('member_id', memberId!)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw toError(error);
      return (data ?? []) as unknown as MemberBooking[];
    },
  });
}

/** 회원 본인용: 내 수강권 1장 + 사용/복구/연장 변동 내역 */
export function useMyPassDetail(passId: string | undefined) {
  return useQuery({
    queryKey: ['my-pass', passId],
    enabled: !!passId,
    queryFn: async (): Promise<{ pass: Pass; logs: Omit<PassDetail['logs'][number], 'actor'>[] }> => {
      const [passRes, logsRes] = await Promise.all([
        supabase.from('passes').select('*').eq('id', passId!).maybeSingle(),
        supabase
          .from('pass_logs')
          .select('id, delta, remaining_after, reason, memo, created_at')
          .eq('pass_id', passId!)
          .order('id', { ascending: false }),
      ]);
      if (passRes.error) throw toError(passRes.error);
      if (logsRes.error) throw toError(logsRes.error);
      if (!passRes.data) throw new Error('수강권을 찾을 수 없습니다.');
      return {
        pass: passRes.data as Pass,
        logs: (logsRes.data ?? []) as Omit<PassDetail['logs'][number], 'actor'>[],
      };
    },
  });
}

// ---------------------------------------------------------------------------
// 예약 / 취소 / 출석 (모두 DB 함수 호출 — 스튜디오 권한은 DB 가 검사)
// ---------------------------------------------------------------------------

export function useBookClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { classId: string; memberId?: string }): Promise<Booking> => {
      const { data, error } = await supabase.rpc('book_class', {
        p_class_id: vars.classId,
        p_member_id: vars.memberId ?? null,
      });
      if (error) throw toError(error);
      return data as Booking;
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}

export function useCancelBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    /** refund 는 직원이 대신 취소할 때만 의미가 있다. 회원 본인 취소는 서버가 24시간 규정으로 결정 */
    mutationFn: async (vars: { bookingId: string; refund?: boolean }): Promise<Booking> => {
      const { data, error } = await supabase.rpc('cancel_booking', {
        p_booking_id: vars.bookingId,
        p_refund: vars.refund ?? null,
      });
      if (error) throw toError(error);
      return data as Booking;
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}

type AttendanceStatus = Extract<BookingStatus, 'attended' | 'no_show' | 'confirmed'>;

export function useMarkAttendance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { bookingId: string; status: AttendanceStatus }): Promise<Booking> => {
      const { data, error } = await supabase.rpc('mark_attendance', {
        p_booking_id: vars.bookingId,
        p_status: vars.status,
      });
      if (error) throw toError(error);
      return data as Booking;
    },
    // 원클릭 체감 속도: 타임라인/수업 상세 캐시를 먼저 바꾸고, 끝나면 서버 값으로 다시 맞춘다
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['timeline'] });
      const patch = (cls: TimelineClass): TimelineClass => ({
        ...cls,
        bookings: cls.bookings.map((b) => (b.id === vars.bookingId ? { ...b, status: vars.status } : b)),
      });
      queryClient.setQueriesData<TimelineClass[] | TimelineClass | null>({ queryKey: ['timeline'] }, (old) => {
        if (!old) return old;
        return Array.isArray(old) ? old.map(patch) : patch(old);
      });
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}

// ---------------------------------------------------------------------------
// 직원 — 수업
// ---------------------------------------------------------------------------

/** 하루치 수업 타임라인. instructorId 가 null 이면 전체 강사 */
export function useTimeline(studioId: string, day: Dayjs, instructorId: string | null) {
  const from = day.startOf('day').toISOString();
  const to = day.startOf('day').add(1, 'day').toISOString();
  return useQuery({
    queryKey: ['timeline', studioId, from, instructorId ?? 'all'],
    enabled: !!studioId,
    queryFn: async (): Promise<TimelineClass[]> => {
      let query = supabase
        .from('classes')
        .select(TIMELINE_SELECT)
        .eq('studio_id', studioId)
        .eq('status', 'scheduled')
        .gte('starts_at', from)
        .lt('starts_at', to)
        .order('starts_at', { ascending: true });
      if (instructorId) query = query.eq('instructor_id', instructorId);

      const { data, error } = await query;
      if (error) throw toError(error);
      return ((data ?? []) as unknown as TimelineClass[]).map(normalizeTimelineClass);
    },
  });
}

/** 수업 1건 상세 (출석부 포함). 키를 ['timeline', ...] 아래에 둬서 출석 낙관적 업데이트가 함께 적용된다 */
export function useClassDetail(classId: string | undefined) {
  return useQuery({
    queryKey: ['timeline', 'class', classId],
    enabled: !!classId,
    queryFn: async (): Promise<TimelineClass> => {
      const { data, error } = await supabase.from('classes').select(TIMELINE_SELECT).eq('id', classId!).maybeSingle();
      if (error) throw toError(error);
      if (!data) throw new Error('수업을 찾을 수 없습니다.');
      return normalizeTimelineClass(data as unknown as TimelineClass);
    },
  });
}

/** 이 스튜디오의 수업 담당 가능자(원장·관리자·강사) */
export function useInstructors(studioId: string) {
  return useQuery({
    queryKey: ['instructors', studioId],
    enabled: !!studioId,
    queryFn: async (): Promise<(Pick<UserProfile, 'id' | 'name'> & { role: Role })[]> => {
      const { data, error } = await supabase
        .from('studio_members')
        .select('role, user:users(id, name)')
        .eq('studio_id', studioId)
        .eq('status', 'active')
        .in('role', ['owner', 'manager', 'instructor']);
      if (error) throw toError(error);
      return ((data ?? []) as unknown as { role: Role; user: Pick<UserProfile, 'id' | 'name'> | null }[])
        .filter((r) => r.user)
        .map((r) => ({ ...r.user!, role: r.role }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    },
  });
}

/** 수업 등록(반복 포함). 여러 행을 한 번에 넣으므로 하나라도 겹치면 전부 취소된다 */
export function useCreateClasses() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rows: NewClassInput[]): Promise<number> => {
      const { error } = await supabase.from('classes').insert(rows);
      if (error) throw toError(error);
      return rows.length;
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}

/** 정원 변경. 늘리면 DB 트리거가 대기자를 자동 승격한다 */
export function useUpdateCapacity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { classId: string; capacity: number }) => {
      const { error } = await supabase.from('classes').update({ max_capacity: vars.capacity }).eq('id', vars.classId);
      if (error) throw toError(error);
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}

/** 수업 정보 수정(제목·시간·장소·담당 강사). 시간 중복 및 권한은 DB 가 검사한다 */
export function useUpdateClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      classId: string;
      title: string;
      starts_at: string;
      ends_at: string;
      instructor_id: string;
      location: string | null;
    }) => {
      const { error } = await supabase
        .from('classes')
        .update({
          title: vars.title,
          starts_at: vars.starts_at,
          ends_at: vars.ends_at,
          instructor_id: vars.instructor_id,
          location: vars.location,
        })
        .eq('id', vars.classId);
      if (error) throw toError(error);
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}

/** 폐강: 확정 예약자 전원 횟수 복구 후 취소 */
export function useCancelClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (classId: string): Promise<number> => {
      const { data, error } = await supabase.rpc('cancel_class', { p_class_id: classId });
      if (error) throw toError(error);
      return data as number;
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}

// ---------------------------------------------------------------------------
// 직원 — 사람
// ---------------------------------------------------------------------------

type MemberRow = { role: Role; memo: string | null; joined_at: string; user: Omit<UserProfile, 'phone' | 'email'> | null };
type Contact = { user_id: string; phone: string | null; email: string | null };
const toPerson = (r: MemberRow, contacts: Map<string, Contact>): StudioPerson => ({
  ...r.user!,
  phone: contacts.get(r.user!.id)?.phone ?? null,
  email: contacts.get(r.user!.id)?.email ?? null,
  role: r.role,
  memo: r.memo,
  joined_at: r.joined_at,
});
/** 연락처는 표에서 직접 못 읽고 함수로만 받는다 (patch 019): 직원에게, 지금 소속인 사람 것만. 이메일은 원장·실장만 */
const USER_COLUMNS = 'id, name, created_at, withdrawn_at';
async function studioContacts(studioId: string): Promise<Map<string, Contact>> {
  const { data, error } = await supabase.rpc('studio_contacts', { p_studio_id: studioId });
  if (error) throw toError(error);
  return new Map(((data ?? []) as Contact[]).map((c) => [c.user_id, c]));
}

/** 이 스튜디오의 전체 명단(회원 + 직원) + 각자의 이 스튜디오 수강권 */
export function useMembers(studioId: string) {
  return useQuery({
    queryKey: ['members', studioId],
    enabled: !!studioId,
    queryFn: async (): Promise<MemberWithPasses[]> => {
      const [peopleRes, passesRes, contacts] = await Promise.all([
        supabase
          .from('studio_members')
          .select(`role, memo, joined_at, user:users(${USER_COLUMNS})`)
          .eq('studio_id', studioId)
          .eq('status', 'active'),
        supabase.from('passes').select('*').eq('studio_id', studioId),
        studioContacts(studioId),
      ]);
      if (peopleRes.error) throw toError(peopleRes.error);
      if (passesRes.error) throw toError(passesRes.error);

      const passesByMember = new Map<string, Pass[]>();
      for (const pass of (passesRes.data ?? []) as Pass[]) {
        const list = passesByMember.get(pass.member_id) ?? [];
        list.push(pass);
        passesByMember.set(pass.member_id, list);
      }
      return ((peopleRes.data ?? []) as unknown as MemberRow[])
        .filter((r) => r.user)
        .map((r) => ({ ...toPerson(r, contacts), passes: passesByMember.get(r.user!.id) ?? [] }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    },
  });
}

/** 회원 상세: 이 스튜디오에서의 소속·역할·메모 + 수강권 + 예약 이력 */
export function useMemberDetail(studioId: string, memberId: string | undefined) {
  return useQuery({
    queryKey: ['member', studioId, memberId],
    enabled: !!studioId && !!memberId,
    queryFn: async (): Promise<MemberDetail> => {
      const [personRes, passesRes, bookingsRes, contacts] = await Promise.all([
        supabase
          .from('studio_members')
          .select(`role, memo, joined_at, user:users(${USER_COLUMNS})`)
          .eq('studio_id', studioId)
          .eq('user_id', memberId!)
          .eq('status', 'active')
          .maybeSingle(),
        supabase
          .from('passes')
          .select('*')
          .eq('studio_id', studioId)
          .eq('member_id', memberId!)
          .order('expires_on', { ascending: false }),
        supabase
          .from('bookings')
          .select(
            `id, status, pass_id, pass_refunded, promoted_at, cancelled_at, created_at,
             class:classes!bookings_class_id_fkey ( id, title, starts_at, ends_at, max_capacity, class_type, instructor_id,
               instructor:users!classes_instructor_id_fkey ( name ) )`,
          )
          .eq('studio_id', studioId)
          .eq('member_id', memberId!)
          .order('created_at', { ascending: false })
          .limit(300),
        studioContacts(studioId),
      ]);

      if (personRes.error) throw toError(personRes.error);
      if (passesRes.error) throw toError(passesRes.error);
      if (bookingsRes.error) throw toError(bookingsRes.error);
      const row = personRes.data as unknown as MemberRow | null;
      if (!row?.user) throw new Error('이 스튜디오에 소속된 사람이 아닙니다.');

      return {
        profile: toPerson(row, contacts),
        passes: (passesRes.data ?? []) as Pass[],
        bookings: (bookingsRes.data ?? []) as unknown as MemberBooking[],
      };
    },
  });
}

// ---------------------------------------------------------------------------
// 원장·관리자 — 수강권 (모든 변경은 DB 함수 → 변동 내역에 기록)
// ---------------------------------------------------------------------------

export function useIssuePass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: IssuePassInput): Promise<Pass> => {
      const { data, error } = await supabase.rpc('issue_pass', {
        p_studio_id: input.studioId,
        p_member_id: input.memberId,
        p_class_type: input.classType,
        p_name: input.name,
        p_total: input.total,
        p_starts_on: input.startsOn,
        p_expires_on: input.expiresOn,
        p_amount: input.amount,
        p_method: input.method,
        p_memo: input.memo,
      });
      if (error) throw toError(error);
      return data as Pass;
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}

/** 수강권 1장 + 변동 내역 + 결제 기록(원장만) */
export function usePassDetail(passId: string | undefined) {
  return useQuery({
    queryKey: ['pass', passId],
    enabled: !!passId,
    queryFn: async (): Promise<PassDetail> => {
      const [passRes, logsRes, payRes] = await Promise.all([
        supabase.from('passes').select('*, member:users!passes_member_id_fkey(id, name)').eq('id', passId!).maybeSingle(),
        supabase
          .from('pass_logs')
          .select('id, delta, remaining_after, reason, memo, created_at, actor:users!pass_logs_actor_id_fkey(name)')
          .eq('pass_id', passId!)
          .order('id', { ascending: false }),
        supabase.from('pass_payments').select('id, amount, method, paid_on, memo').eq('pass_id', passId!),
      ]);
      if (passRes.error) throw toError(passRes.error);
      if (logsRes.error) throw toError(logsRes.error);
      if (!passRes.data) throw new Error('수강권을 찾을 수 없습니다.');
      return {
        pass: passRes.data as unknown as PassDetail['pass'],
        logs: (logsRes.data ?? []) as unknown as PassDetail['logs'],
        // 원장이 아니면 RLS 로 빈 결과. 오류가 나도 결제 정보만 빼고 보여준다
        payments: payRes.error ? [] : ((payRes.data ?? []) as PassDetail['payments']),
      };
    },
  });
}

export function useExtendPass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { passId: string; days: number; memo?: string }) => {
      const { error } = await supabase.rpc('extend_pass', {
        p_pass_id: vars.passId,
        p_days: vars.days,
        p_memo: vars.memo?.trim() || null,
      });
      if (error) throw toError(error);
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}

export function useAdjustPass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { passId: string; delta: number; memo?: string }) => {
      const { error } = await supabase.rpc('admin_adjust_pass', {
        p_pass_id: vars.passId,
        p_delta: vars.delta,
        p_memo: vars.memo?.trim() || null,
      });
      if (error) throw toError(error);
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}

export function useSetPassActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { passId: string; active: boolean; memo?: string }) => {
      const { error } = await supabase.rpc('set_pass_active', {
        p_pass_id: vars.passId,
        p_active: vars.active,
        p_memo: vars.memo?.trim() || null,
      });
      if (error) throw toError(error);
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}

// ---------------------------------------------------------------------------
// 원장 — 매출 (pass_payments 는 RLS 로 원장만 조회 가능)
// ---------------------------------------------------------------------------

export interface RevenueData {
  rows: RevenueRow[];
  prevTotal: number;
  /** 이 달에 발급됐지만 결제 기록이 없는 수강권 수 (금액 미입력 발급) */
  unpaidIssued: number;
}

/** month: 그 달의 아무 날. 결제일(paid_on, 한국 날짜) 기준으로 집계 */
export function useRevenue(studioId: string, month: Dayjs, enabled = true) {
  const from = month.startOf('month').format('YYYY-MM-DD');
  const to = month.startOf('month').add(1, 'month').format('YYYY-MM-DD');
  const prevFrom = month.startOf('month').subtract(1, 'month').format('YYYY-MM-DD');
  return useQuery({
    queryKey: ['revenue', studioId, from],
    enabled: !!studioId && enabled,
    queryFn: async (): Promise<RevenueData> => {
      const [rowsRes, prevRes, issuedRes] = await Promise.all([
        supabase
          .from('pass_payments')
          .select(
            `id, amount, method, paid_on, memo,
             pass:passes!pass_payments_pass_id_fkey ( id, name, class_type ),
             member:users!pass_payments_member_id_fkey ( id, name )`,
          )
          .eq('studio_id', studioId)
          .gte('paid_on', from)
          .lt('paid_on', to)
          .order('paid_on', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase.from('pass_payments').select('amount').eq('studio_id', studioId).gte('paid_on', prevFrom).lt('paid_on', from),
        supabase
          .from('passes')
          .select('id, payments:pass_payments ( id )')
          .eq('studio_id', studioId)
          .gte('created_at', dayjs(from).toISOString())
          .lt('created_at', dayjs(to).toISOString()),
      ]);
      if (rowsRes.error) throw toError(rowsRes.error);
      if (prevRes.error) throw toError(prevRes.error);
      if (issuedRes.error) throw toError(issuedRes.error);
      const issued = (issuedRes.data ?? []) as unknown as { id: string; payments: { id: string }[] | null }[];
      return {
        rows: (rowsRes.data ?? []) as unknown as RevenueRow[],
        prevTotal: ((prevRes.data ?? []) as { amount: number }[]).reduce((s, r) => s + r.amount, 0),
        unpaidIssued: issued.filter((p) => !p.payments || p.payments.length === 0).length,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// 원장·관리자 — 수강권 상품(가격표). 조회·등록·수정은 RLS 로 원장·관리자만, 삭제 대신 숨김
// ---------------------------------------------------------------------------

export function usePassProducts(studioId: string, enabled = true) {
  return useQuery({
    queryKey: ['pass_products', studioId],
    enabled: !!studioId && enabled,
    queryFn: async (): Promise<PassProduct[]> => {
      const { data, error } = await supabase
        .from('pass_products')
        .select('*')
        .eq('studio_id', studioId)
        .order('is_active', { ascending: false })
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw toError(error);
      return (data ?? []) as PassProduct[];
    },
  });
}

export function useSavePassProduct() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.profile?.id);
  return useMutation({
    mutationFn: async (vars: { studioId: string; id?: string; values: PassProductInput }): Promise<void> => {
      const values = { ...vars.values, name: vars.values.name.trim() };
      const { error } = vars.id
        ? await supabase.from('pass_products').update(values).eq('id', vars.id)
        : await supabase.from('pass_products').insert({ ...values, studio_id: vars.studioId, created_by: userId });
      if (error) throw toError(error);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['pass_products'] }),
  });
}

/** 발급 후 결제 추가 (원장·관리자). 결제 목록은 원장만 보인다 */
export function useAddPayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { passId: string; amount: number; method: PaymentMethod; paidOn: string; memo?: string }) => {
      const { error } = await supabase.rpc('add_pass_payment', {
        p_pass_id: vars.passId,
        p_amount: vars.amount,
        p_method: vars.method,
        p_paid_on: vars.paidOn,
        p_memo: vars.memo?.trim() || null,
      });
      if (error) throw toError(error);
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
}

// ---------------------------------------------------------------------------
// 알림함 (본인 것만 — RLS)
// ---------------------------------------------------------------------------

export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string;
  data: { path?: string } | null;
  created_at: string;
  read_at: string | null;
  studio: { name: string } | null;
}

export function useNotifications() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['notifications', userId],
    enabled: !!userId,
    refetchInterval: 60_000,
    queryFn: async (): Promise<AppNotification[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, kind, title, body, data, created_at, read_at, studio:studios!notifications_studio_id_fkey ( name )')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw toError(error);
      return (data ?? []) as unknown as AppNotification[];
    },
  });
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids?: number[]) => {
      const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids ?? null });
      if (error) throw toError(error);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

// ---------- 스튜디오 운영 종료 (원장, 패치 014·015) ----------
export interface CloseRequest {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason: string;
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
}

export interface CloseStudioPreview {
  classes: number;
  bookings: number;
  members: number;
  /** 남은 수강권(만료 전 남은 횟수 + 예정 예약 + 최근 30일 안에 줄인 횟수). 있으면 바로 종료 불가 → 운영자 승인 요청 */
  open?: { members: number; remaining: number; list: { name: string; remaining: number }[] };
  request?: CloseRequest | null;
}

export function useCloseStudioPreview(studioId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['close-studio-preview', studioId],
    enabled: enabled && !!studioId,
    queryFn: async (): Promise<CloseStudioPreview> => {
      const { data, error } = await supabase.rpc('close_studio_preview', { p_studio_id: studioId });
      if (error) throw toError(error);
      return data as CloseStudioPreview;
    },
  });
}

export function useCloseStudio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { studioId: string; confirmName: string }): Promise<CloseStudioPreview & { notified: number }> => {
      const { data, error } = await supabase.rpc('close_studio', { p_studio_id: vars.studioId, p_confirm_name: vars.confirmName });
      if (error) throw toError(error);
      const r = data as { classes: number; bookings: number; notified: number };
      return { classes: r.classes, bookings: r.bookings, members: r.notified, notified: r.notified };
    },
    onSuccess: () => {
      // 종료 후엔 더 이상 원장이 아니므로 미리보기를 다시 부르지 않는다(권한 오류 방지)
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'close-studio-preview' });
    },
  });
}

/** 남은 수강권이 있을 때: 운영자에게 운영 종료 요청 (사유 5자 이상) */
export function useRequestStudioClose() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { studioId: string; reason: string }): Promise<CloseRequest> => {
      const { data, error } = await supabase.rpc('request_studio_close', { p_studio_id: vars.studioId, p_reason: vars.reason });
      if (error) throw toError(error);
      return data as CloseRequest;
    },
    onSettled: (_d, _e, vars) => queryClient.invalidateQueries({ queryKey: ['close-studio-preview', vars.studioId] }),
  });
}

export function useCancelStudioCloseRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { studioId: string; requestId: string }): Promise<CloseRequest> => {
      const { data, error } = await supabase.rpc('cancel_studio_close_request', { p_request_id: vars.requestId });
      if (error) throw toError(error);
      return data as CloseRequest;
    },
    onSettled: (_d, _e, vars) => queryClient.invalidateQueries({ queryKey: ['close-studio-preview', vars.studioId] }),
  });
}

// ---------- 스튜디오 소개 페이지 · 체험 신청 (원장·실장, 패치 016) ----------
export function useStudioPage(studioId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['studio-page', studioId],
    enabled: enabled && !!studioId,
    queryFn: async (): Promise<StudioPage | null> => {
      const { data, error } = await supabase.from('studio_pages').select('*').eq('studio_id', studioId).maybeSingle();
      if (error) throw toError(error);
      return (data as StudioPage | null) ?? null;
    },
  });
}

export function useSaveStudioPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { studioId: string; page: StudioPageInput }): Promise<StudioPage> => {
      const { data, error } = await supabase.rpc('save_studio_page', { p_studio_id: vars.studioId, p_page: vars.page });
      if (error) throw toError(error);
      return data as StudioPage;
    },
    onSuccess: (data, vars) => queryClient.setQueryData(['studio-page', vars.studioId], data),
  });
}

export function useTrialRequests(studioId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['trial-requests', studioId],
    enabled: enabled && !!studioId,
    refetchInterval: 60_000,
    queryFn: async (): Promise<TrialRequest[]> => {
      const { data, error } = await supabase
        .from('trial_requests')
        .select('id, studio_id, name, phone, preferred, message, status, memo, handled_at, created_at')
        .eq('studio_id', studioId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw toError(error);
      return (data ?? []) as TrialRequest[];
    },
  });
}

export function useUpdateTrialRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { studioId: string; id: string; status: TrialStatus; memo?: string | null }): Promise<TrialRequest> => {
      const { data, error } = await supabase.rpc('update_trial_request', { p_id: vars.id, p_status: vars.status, p_memo: vars.memo ?? null });
      if (error) throw toError(error);
      return data as TrialRequest;
    },
    onSettled: (_d, _e, vars) => queryClient.invalidateQueries({ queryKey: ['trial-requests', vars.studioId] }),
  });
}
