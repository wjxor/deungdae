import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// 프론트 개발 서버(Vite 기본 포트). 배포한 서버에도 열어 두어 로컬 웹에서 배포 서버를 부를 수 있다
const DEV_ORIGIN = 'http://localhost:5173';

/**
 * CORS를 허용할 주소. 개발 서버에 더해 환경변수 CORS_ORIGINS(쉼표로 구분)에 적은 배포 주소를 연다.
 * 브라우저가 보내는 Origin에는 끝 `/`가 없어서, 붙여 적어도 떼고 비교한다
 */
export function allowedOrigins(corsOrigins: string | undefined): string[] {
  const deployed = (corsOrigins ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);
  return [...new Set([DEV_ORIGIN, ...deployed])];
}

/** 실행(main.ts)과 e2e 테스트가 같은 설정을 쓰도록 앱 공통 설정을 한곳에 모은다 */
export function configureApp(app: INestApplication): void {
  // 모든 경로는 /api 아래 (API.md Base URL)
  app.setGlobalPrefix('api');
  const config = app.get(ConfigService);
  app.enableCors({ origin: allowedOrigins(config.get<string>('CORS_ORIGINS')) });
}
