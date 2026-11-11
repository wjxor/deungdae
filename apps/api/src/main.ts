import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

/** 등대 API 서버를 띄운다 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`http://localhost:${port}/api 에서 대기 중`, 'Bootstrap');
}
// await하지 않는다. Vercel은 이 파일을 불러올 때 listen()을 가로채 서버만 챙기고 완료 콜백은 부르지 않아서,
// 여기서 기다리면 파일 불러오기가 끝나지 않고 모든 요청이 멈춘다 (2026-11-11 첫 배포에서 확인)
void bootstrap();
