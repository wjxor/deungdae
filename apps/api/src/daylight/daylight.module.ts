import { Module } from '@nestjs/common';
import { DaylightController } from './daylight.controller.js';
import { DaylightService } from './daylight.service.js';
import { KasiRiseSetClient } from './kasi-rise-set.client.js';

/** 주야간 판별 (FR-005). 천문연 출몰시각 호출은 여기서만 써서 같은 모듈에 둔다 */
@Module({
  controllers: [DaylightController],
  providers: [DaylightService, KasiRiseSetClient],
})
export class DaylightModule {}
