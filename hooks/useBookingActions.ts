

import { useBookClass, useCancelBooking } from '@/hooks/queries';
import { formatDay, formatTime, isRefundableNow } from '@/lib/date';
import type { ClassOverview } from '@/lib/types';
import { showDialog } from '@/lib/dialog';

/**
 * 회원의 예약 / 대기 신청 / 취소 흐름.
 * 누르기 전에 "횟수가 어떻게 되는지"를 항상 먼저 알려준다.
 */
export function useBookingActions() {
  const book = useBookClass();
  const cancel = useCancelBooking();

  const pendingClassId = book.isPending ? book.variables?.classId : undefined;
  const pendingBookingId = cancel.isPending ? cancel.variables?.bookingId : undefined;

  const isBusy = (cls: ClassOverview) =>
    pendingClassId === cls.id || (!!cls.my_booking_id && pendingBookingId === cls.my_booking_id);

  const requestBook = (cls: ClassOverview) => {
    const isFull = cls.confirmed_count >= cls.max_capacity;
    const when = `${formatDay(cls.starts_at)} ${formatTime(cls.starts_at)}`;

    showDialog(
      isFull ? '대기 신청' : '예약하기',
      isFull
        ? `${when} ${cls.title}\n\n현재 대기 ${cls.waitlist_count}명입니다. 대기 중에는 수강권이 차감되지 않고, 자리가 나면 자동으로 예약이 확정되며 그때 1회 차감됩니다.`
        : `${when} ${cls.title}\n\n예약하면 수강권이 1회 차감됩니다.`,
      [
        { text: '닫기', style: 'cancel' },
        {
          text: isFull ? '대기 신청' : '예약',
          onPress: () =>
            book.mutate(
              { classId: cls.id },
              {
                onSuccess: (booking) =>
                  showDialog(
                    booking.status === 'confirmed' ? '예약이 확정되었습니다' : '대기 신청이 완료되었습니다',
                    booking.status === 'confirmed'
                      ? '수강권 1회가 차감되었습니다.'
                      : '자리가 나면 자동으로 예약이 확정됩니다.',
                  ),
                onError: (error) => showDialog('예약할 수 없습니다', error.message),
              },
            ),
        },
      ],
    );
  };

  const requestCancel = (cls: ClassOverview) => {
    if (!cls.my_booking_id) return;
    const bookingId = cls.my_booking_id;
    const isWaitlist = cls.my_booking_status === 'waitlist';
    const refundable = isRefundableNow(cls.starts_at);

    showDialog(
      isWaitlist ? '대기 취소' : '예약 취소',
      isWaitlist
        ? '대기 신청을 취소할까요? 차감된 수강권은 없습니다.'
        : refundable
          ? '수업 시작 24시간 전이므로 수강권 1회가 복구됩니다.'
          : '수업 시작 24시간 이내에는 취소해도 수강권 횟수가 복구되지 않습니다. 그래도 취소할까요?',
      [
        { text: '닫기', style: 'cancel' },
        {
          text: isWaitlist ? '대기 취소' : '예약 취소',
          style: 'destructive',
          onPress: () =>
            cancel.mutate(
              { bookingId },
              {
                onSuccess: (booking) =>
                  showDialog(
                    '취소되었습니다',
                    isWaitlist
                      ? undefined
                      : booking.pass_refunded
                        ? '수강권 1회가 복구되었습니다.'
                        : '24시간 이내 취소로 수강권은 복구되지 않았습니다.',
                  ),
                onError: (error) => showDialog('취소할 수 없습니다', error.message),
              },
            ),
        },
      ],
    );
  };

  return { requestBook, requestCancel, isBusy };
}
