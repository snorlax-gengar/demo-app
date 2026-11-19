import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { dayjs, formatDate, startOfWeek, type Dayjs } from '@/lib/date';

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

interface ModalProps {
  visible: boolean;
  value: Dayjs;
  minDate?: Dayjs;
  maxDate?: Dayjs;
  title?: string;
  onSelect: (date: Dayjs) => void;
  onClose: () => void;
}

/** 공용 미니 달력 모달 (iOS · Android · Web 동일 동작, 네이티브 모듈 불필요) */
export function DatePickerModal({ visible, value, minDate, maxDate, title = '날짜 선택', onSelect, onClose }: ModalProps) {
  const [month, setMonth] = useState(() => value.startOf('month'));

  useEffect(() => {
    if (visible) setMonth(value.startOf('month'));
  }, [visible, value]);

  const today = dayjs().startOf('day');
  const gridStart = startOfWeek(month);
  const days = Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'));
  const visibleDays = days[35].isSame(month, 'month') ? days : days.slice(0, 35);

  const isDisabled = (d: Dayjs) =>
    (!!minDate && d.isBefore(minDate, 'day')) || (!!maxDate && d.isAfter(maxDate, 'day'));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} className="flex-1 items-center justify-center bg-black/40 px-5">
        <Pressable onPress={(e) => e.stopPropagation()} className="w-full max-w-[360px] rounded-3xl bg-white p-5">
          <View className="flex-row items-center justify-between">
            <Text className="text-base font-bold text-ink">{title}</Text>
            <Pressable
              onPress={onClose}
              accessibilityLabel="닫기"
              className="h-8 w-8 items-center justify-center rounded-full active:bg-stone-100">
              <Ionicons name="close" size={20} color="#57534E" />
            </Pressable>
          </View>

          <View className="mt-3 flex-row items-center justify-between">
            <Pressable
              onPress={() => setMonth((m) => m.subtract(1, 'month'))}
              accessibilityLabel="이전 달"
              className="h-9 w-9 items-center justify-center rounded-full bg-surface active:opacity-70">
              <Ionicons name="chevron-back" size={18} color="#2F3842" />
            </Pressable>
            <Text className="text-base font-bold text-ink">{month.format('YYYY년 M월')}</Text>
            <Pressable
              onPress={() => setMonth((m) => m.add(1, 'month'))}
              accessibilityLabel="다음 달"
              className="h-9 w-9 items-center justify-center rounded-full bg-surface active:opacity-70">
              <Ionicons name="chevron-forward" size={18} color="#2F3842" />
            </Pressable>
          </View>

          <View className="mt-4 flex-row">
            {WEEKDAYS.map((label, i) => (
              <Text
                key={label}
                className={`flex-1 text-center text-xs font-semibold ${i === 5 ? 'text-sky-600' : i === 6 ? 'text-rose-500' : 'text-stone-400'}`}>
                {label}
              </Text>
            ))}
          </View>

          <View className="mt-2 flex-row flex-wrap">
            {visibleDays.map((day) => {
              const inMonth = day.isSame(month, 'month');
              const selected = day.isSame(value, 'day');
              const isToday = day.isSame(today, 'day');
              const disabled = isDisabled(day);
              return (
                <Pressable
                  key={day.valueOf()}
                  disabled={disabled}
                  onPress={() => {
                    onSelect(day.startOf('day'));
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={formatDate(day.toISOString())}
                  style={{ width: `${100 / 7}%` }}
                  className="items-center py-1">
                  <View
                    className={`h-9 w-9 items-center justify-center rounded-full ${
                      selected ? 'bg-brand-600' : isToday ? 'border border-brand-500' : ''
                    }`}>
                    <Text
                      className={`text-sm font-semibold ${
                        selected
                          ? 'text-white'
                          : disabled
                            ? 'text-stone-300'
                            : !inMonth
                              ? 'text-stone-300'
                              : isToday
                                ? 'text-brand-700'
                                : 'text-ink'
                      }`}>
                      {day.date()}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {!isDisabled(today) ? (
            <Pressable
              onPress={() => {
                onSelect(today);
                onClose();
              }}
              className="mt-3 items-center rounded-2xl bg-surface py-2.5 active:opacity-70">
              <Text className="text-sm font-semibold text-brand-700">오늘 선택</Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface FieldProps {
  value: Dayjs;
  label: string;
  onChange: (date: Dayjs) => void;
  minDate?: Dayjs;
  maxDate?: Dayjs;
  modalTitle?: string;
}

/** ±1일 버튼 + 가운데 날짜를 누르면 미니 달력 모달이 열리는 날짜 선택기 */
export function DateField({ value, label, onChange, minDate, maxDate, modalTitle }: FieldProps) {
  const [open, setOpen] = useState(false);
  const minusDisabled = !!minDate && !value.isAfter(minDate, 'day');
  const plusDisabled = !!maxDate && !value.isBefore(maxDate, 'day');

  return (
    <>
      <View className="flex-row items-center">
        <Pressable
          onPress={() => onChange(value.subtract(1, 'day'))}
          disabled={minusDisabled}
          accessibilityLabel="하루 전"
          className={`h-8 w-8 items-center justify-center rounded-full bg-stone-100 active:opacity-70 ${minusDisabled ? 'opacity-30' : ''}`}>
          <Ionicons name="remove" size={18} color="#44403C" />
        </Pressable>
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${label} 달력에서 선택`}
          className="mx-2 flex-row items-center rounded-full bg-white px-3 py-1.5 active:opacity-70">
          <Ionicons name="calendar-outline" size={14} color="#0B7A4D" />
          <Text className="ml-1.5 text-sm font-bold text-ink">{label}</Text>
        </Pressable>
        <Pressable
          onPress={() => onChange(value.add(1, 'day'))}
          disabled={plusDisabled}
          accessibilityLabel="하루 뒤"
          className={`h-8 w-8 items-center justify-center rounded-full bg-stone-100 active:opacity-70 ${plusDisabled ? 'opacity-30' : ''}`}>
          <Ionicons name="add" size={18} color="#44403C" />
        </Pressable>
      </View>
      <DatePickerModal
        visible={open}
        value={value}
        minDate={minDate}
        maxDate={maxDate}
        title={modalTitle}
        onSelect={onChange}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
