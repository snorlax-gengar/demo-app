/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  // 웹 개발 서버에서 NativeWind 가 색 모드를 재설정하다 'media' 모드 오류를 내는 문제 방지. 앱은 라이트 전용
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 스튜디오 톤의 차분한 그린. 브랜드 색만 바꾸면 과외 앱으로 재사용 가능
        brand: {
          50: '#EEF6F3',
          100: '#D7EAE4',
          200: '#B0D5CA',
          400: '#4FA592',
          500: '#2F8F7A',
          600: '#24766A',
          700: '#1C5D54',
          900: '#12332F',
        },
        canvas: '#F6F5F1',
        ink: '#1B1F1E',
      },
    },
  },
  plugins: [],
};
