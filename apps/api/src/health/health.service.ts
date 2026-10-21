import { Injectable, Logger } from '@nestjs/common';
import type { HealthResponse } from '../../../../shared/types.js';
import { toKstIso } from '../common/time.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 서버 상태와 DB 연결 여부를 돌려준다 (API.md 1장). DB가 안 돼도 서버가 답하면 `status`는 ok */
  async check(): Promise<HealthResponse> {
    return {
      status: 'ok',
      db: await this.pingDb(),
      time: toKstIso(new Date()),
    };
  }

  /** DB에 `SELECT 1`을 보내 연결을 확인한다 */
  private async pingDb(): Promise<HealthResponse['db']> {
    if (!this.prisma.configured) return 'error';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'ok';
    } catch (e) {
      this.logger.warn(
        `DB 연결 실패: ${e instanceof Error ? e.message : String(e)}`,
      );
      return 'error';
    }
  }
}
