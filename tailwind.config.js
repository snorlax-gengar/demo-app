/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  // 웹 개발 서버에서 NativeWind 가 색 모드를 재설정하다 'media' 모드 오류를 내는 문제 방지. 앱은 라이트 전용
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // PIQ 마크 기준 팔레트(흰 배경 · 진회색 글씨 · 초록). 브랜드 색만 바꾸면 다른 앱으로 재사용 가능
        brand: {
          50: '#ECFDF5',
          100: '#D1FAE5',
          200: '#A7F3D0',
          400: '#53FAA6', // 마크의 민트 — 포인트(진행 막대·선택 표시)에만. 흰 글씨 X
          500: '#16A866',
          600: '#0B7A4D', // 메인: 버튼·강조 (흰 글씨 대비 5.4)
          700: '#0B6E46',
          900: '#063D27',
        },
        canvas: '#FFFFFF', // 화면 바탕
        surface: '#F4F7F5', // 카드·칩·원형 버튼 바탕 (흰 바탕과 구분)
        ink: '#2F3842', // 마크 테두리색 = 본문 글자
      },
    },
  },
  plugins: [],
};
