import { Injectable, Logger } from '@nestjs/common';
import type { DaylightResponse } from '../../../../shared/types.js';
import { dbErrorText } from '../common/db-error.js';
import { toKstDate, toKstIso } from '../common/time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { KasiRiseSetClient, type SunTimes } from './kasi-rise-set.client.js';

/** 천문연 요청의 `location`이자 `sun_times.region` (ERD). 대전 한 지점 기준 */
const REGION = '대전';

/** 일출 전이거나 일몰 후면 야간 (API.md 1-1장) */
export function isNight(now: Date, { sunrise, sunset }: SunTimes): boolean {
  return now.getTime() < sunrise.getTime() || now.getTime() > sunset.getTime();
}

/** `sun_times.date`(date 컬럼)에 넣는 값. Prisma는 Date의 UTC 날짜 부분을 쓴다 */
function dbDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/**
 * 주야간 판별 (FR-005). 천문연 출몰시각은 하루 한 번만 부른다.
 * - 같은 날 요청은 서버 메모리의 값을 같이 쓴다 (동시에 와도 천문연·DB를 한 번만 부름)
 * - 서버를 다시 켜도 DB `sun_times`에 있으면 천문연을 부르지 않는다
 * - DB가 없거나 안 되면 천문연 값만 쓴다 (판별 자체는 실패시키지 않음)
 */
@Injectable()
export class DaylightService {
  private readonly logger = new Logger(DaylightService.name);

  /** 오늘(한국 날짜) 일출·일몰. 실패한 조회는 남기지 않아 다음 요청이 다시 부른다 */
  private memo: { date: string; sunTimes: Promise<SunTimes> } | null = null;

  constructor(
    private readonly kasi: KasiRiseSetClient,
    private readonly prisma: PrismaService,
  ) {}

  /** 오늘 대전의 일출·일몰과 지금이 야간인지. 천문연 실패는 502 EXTERNAL_API_ERROR */
  async today(): Promise<DaylightResponse> {
    const now = new Date();
    const sunTimes = await this.sunTimes(toKstDate(now));
    return {
      sunrise: toKstIso(sunTimes.sunrise),
      sunset: toKstIso(sunTimes.sunset),
      isNight: isNight(now, sunTimes),
    };
  }

  /** 그 날의 일출·일몰. 같은 날이면 진행 중이거나 끝난 조회를 같이 쓴다 */
  private sunTimes(date: string): Promise<SunTimes> {
    if (this.memo?.date === date) return this.memo.sunTimes;

    const memo = { date, sunTimes: this.load(date) };
    this.memo = memo;
    memo.sunTimes.catch(() => {
      if (this.memo === memo) this.memo = null;
    });
    return memo.sunTimes;
  }

  /** DB에 있으면 그 값, 없으면 천문연을 불러 DB에 넣는다 */
  private async load(date: string): Promise<SunTimes> {
    const stored = await this.read(date);
    if (stored) return stored;

    const sunTimes = await this.kasi.riseSet(date, REGION);
    await this.save(date, sunTimes);
    return sunTimes;
  }

  /** `sun_times`의 그 날 행. 없거나 DB가 안 되면 null */
  private async read(date: string): Promise<SunTimes | null> {
    if (!this.prisma.configured) return null;
    try {
      return await this.prisma.sunTime.findUnique({
        where: { date_region: { date: dbDate(date), region: REGION } },
        select: { sunrise: true, sunset: true },
      });
    } catch (e) {
      this.logger.warn(`일출·일몰 캐시 읽기 실패: ${dbErrorText(e)}`);
      return null;
    }
  }

  /** 천문연에서 받은 값을 `sun_times`에 넣는다. 실패해도 응답은 그대로 한다 */
  private async save(date: string, { sunrise, sunset }: SunTimes) {
    if (!this.prisma.configured) return;
    try {
      await this.prisma.sunTime.upsert({
        where: { date_region: { date: dbDate(date), region: REGION } },
        create: { date: dbDate(date), region: REGION, sunrise, sunset },
        update: { sunrise, sunset, fetchedAt: new Date() },
      });
    } catch (e) {
      this.logger.warn(`일출·일몰 캐시 저장 실패: ${dbErrorText(e)}`);
    }
  }
}
