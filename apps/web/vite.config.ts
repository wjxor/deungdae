import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // manifest와 서비스 워커. 서비스 워커는 앱 파일(index.html·JS·CSS·아이콘)만 저장하고,
    // 카카오 지도·우리 API 요청은 가로채지 않는다 (runtimeCaching을 두지 않음)
    VitePWA({
      // 페이지가 다 뜬 뒤 등록하는 스크립트(registerSW.js)를 index.html에 넣는다. 개발 서버(npm run dev)에서는 등록하지 않는다
      injectRegister: 'script-defer',
      // 새 버전은 받자마자 켜 두지만 쓰는 중인 화면은 새로고침하지 않는다. 다음에 열거나 새로고침하면 새 버전이 뜬다
      // (이동 중 화면·카카오 로그인 도중에 화면이 바뀌지 않게)
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
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
