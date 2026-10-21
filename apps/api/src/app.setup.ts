import type { INestApplication } from '@nestjs/common';

// 프론트 개발 서버(Vite 기본 포트). 배포 주소는 서버 배포처가 정해지면 추가한다 (ROADMAP "팀에서 정해야 할 것")
const ALLOWED_ORIGINS = ['http://localhost:5173'];

/** 실행(main.ts)과 e2e 테스트가 같은 설정을 쓰도록 앱 공통 설정을 한곳에 모은다 */
export function configureApp(app: INestApplication): void {
  // 모든 경로는 /api 아래 (API.md Base URL)
  app.setGlobalPrefix('api');
  app.enableCors({ origin: ALLOWED_ORIGINS });
}
