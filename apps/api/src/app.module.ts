import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DaylightModule } from './daylight/daylight.module.js';
import { FacilitiesModule } from './facilities/facilities.module.js';
import { HealthModule } from './health/health.module.js';
import { PlacesModule } from './places/places.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RoutesModule } from './routes/routes.module.js';

@Module({
  imports: [
    // 환경변수는 저장소 루트의 .env 하나에 둔다 (apps/web과 같은 파일). npm 스크립트는 apps/api에서 실행된다
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }),
    PrismaModule,
    HealthModule,
    DaylightModule,
    PlacesModule,
    RoutesModule,
    FacilitiesModule,
  ],
})
export class AppModule {}
