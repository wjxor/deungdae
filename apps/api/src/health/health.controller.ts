import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '../../../../shared/types.js';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** GET /api/health — 서버·DB 연결 확인 */
  @Get()
  check(): Promise<HealthResponse> {
    return this.health.check();
  }
}
