import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * DB 연결 (Supabase PostgreSQL, Prisma 7 + pg 어댑터).
 * 서버를 띄울 때 연결하지 않고 첫 쿼리 때 연결한다. DB가 없거나 꺼져 있어도 서버는 뜨고, `/api/health`가 `db: "error"`로 알려 준다.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  /** DATABASE_URL이 설정돼 있는지. 없으면 DB를 부르지 않는다 */
  readonly configured: boolean;

  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    // Transaction pooler(6543) 주소. pg 어댑터는 이름 없는 prepared statement만 써서 Transaction pooler에서도 동작한다
    const connectionString = config.get<string>('DATABASE_URL');
    super({
      adapter: new PrismaPg({
        connectionString,
        connectionTimeoutMillis: 5000,
      }),
    });
    this.configured = Boolean(connectionString);
    if (!this.configured) {
      this.logger.warn(
        'DATABASE_URL이 없어 DB에 연결하지 않습니다. 저장소 루트 .env를 확인하세요',
      );
    }
  }

  /** 서버를 끌 때 연결을 닫는다 */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
