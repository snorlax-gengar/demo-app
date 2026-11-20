# piq.expo.app (EAS Hosting)

- `public/` — 처리방침·약관·계정 삭제·소개 페이지 (`scripts/build-legal-site.mjs` 가 `lib/legal.ts` 로 만든다)
- `app/s/[slug]+api.ts` — 스튜디오 소개 페이지 `/s/<주소 이름>`. 서버에서 HTML 을 만들어 카톡·인스타 링크 미리보기에 스튜디오 이름·사진이 뜬다
- 앱과 node_modules 를 같이 쓴다 (루트에서 `npm install` 한 번이면 됨)

```bash
cd site
npm run build     # 루트 .env 의 EXPO_PUBLIC_SUPABASE_URL / ANON_KEY 를 넣어 dist/ 생성
npm run serve     # http://localhost:8090/s/<주소 이름> 로 미리 보기
npm run deploy    # 빌드 + https://piq.expo.app 배포 (expo 로그인 필요)
```
