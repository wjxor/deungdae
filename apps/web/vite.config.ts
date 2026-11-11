import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // manifest만 만든다. 서비스 워커는 배포 주소가 정해진 뒤에 넣는다 (지도·API 요청은 캐시하지 않는다). 그래서 등록 코드는 넣지 않는다
    VitePWA({
      injectRegister: false,
      manifest: {
        name: '등대',
        short_name: '등대',
        description: '밤에는 가로등·CCTV·안심벨이 많은 길로 안내하는 안심 보행경로 지도',
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
