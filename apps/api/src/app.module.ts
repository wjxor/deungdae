import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    // 환경변수는 저장소 루트의 .env 하나에 둔다 (apps/web과 같은 파일). npm 스크립트는 apps/api에서 실행된다
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }),
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
