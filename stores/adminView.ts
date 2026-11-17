import { create } from 'zustand';

interface AdminViewState {
  /** 원장 전용: 타임라인에 전체 강사 수업을 보여줄지. 기본은 '내 수업만' */
  showAllInstructors: boolean;
  setShowAllInstructors: (value: boolean) => void;
}

export const useAdminViewStore = create<AdminViewState>((set) => ({
  showAllInstructors: false,
  setShowAllInstructors: (value) => set({ showAllInstructors: value }),
}));
