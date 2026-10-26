import { Controller, Get } from '@nestjs/common';
import type { DaylightResponse } from '../../../../shared/types.js';
import { DaylightService } from './daylight.service.js';

@Controller('daylight')
export class DaylightController {
  constructor(private readonly daylight: DaylightService) {}

  /** GET /api/daylight — 오늘 대전 일출·일몰과 지금이 야간인지 (FR-005) */
  @Get()
  today(): Promise<DaylightResponse> {
    return this.daylight.today();
  }
}
