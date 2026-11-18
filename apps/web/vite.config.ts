import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // manifest와 서비스 워커. 서비스 워커는 앱 파일(index.html·JS·CSS·아이콘)만 저장하고,
    // 카카오 지도·우리 API 요청은 가로채지 않는다 (runtimeCaching은 화면 주소 하나뿐)
    VitePWA({
      // 페이지가 다 뜬 뒤 등록하는 스크립트(registerSW.js)를 index.html에 넣는다. 개발 서버(npm run dev)에서는 등록하지 않는다
      injectRegister: 'script-defer',
      // 새 버전은 받자마자 켜 두지만 쓰는 중인 화면은 새로고침하지 않는다
      // (이동 중 화면·카카오 로그인 도중에 화면이 바뀌지 않게)
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // index.html은 미리 저장하지 않는다. 저장본을 먼저 띄우면 배포 직후 처음 열 때 이전 버전이 뜬다 (기본값 js·css·html에서 html만 뺌)
        globPatterns: ['**/*.{js,css}'],
        // 저장본 index.html로 답하는 기본 화면 주소 처리를 끄고, 아래 runtimeCaching이 맡는다
        navigateFallback: null,
        runtimeCaching: [
          {
            // 화면 주소는 열 때마다 서버에서 먼저 받아 새 JS를 가리키게 한다. 오프라인이면 마지막으로 받은 화면을 쓴다.
            // 시간 제한(networkTimeoutSeconds)은 두지 않는다. 느린 망에서 옛 index.html로 넘어가면 이미 지운 옛 JS를 찾게 된다
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              // 로그인 서비스에서 돌아온 주소(?code=…)가 캐시 키로 남지 않게, 쿼리를 떼고 루트 하나로 저장한다 (화면은 루트 하나뿐)
              plugins: [{ cacheKeyWillBeUsed: async ({ request }) => new URL('/', request.url).href }],
            },
          },
        ],
      },
      manifest: {
        name: '등대',
        short_name: '등대',
        description: '밤에는 가로등·CCTV·안심벨이 많은 길로 안내하는 안심 보행경로 지도',
        // 브라우저가 같은 앱으로 알아보는 값. 없으면 start_url을 쓰는데, 나중에 start_url을 바꿔도 설치한 앱이 그대로 이어지게 지금 값으로 고정한다
        id: '/',
        lang: 'ko',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#14171b',
        background_color: '#14171b',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  envDir: '../..',
})
