import { Injectable, Logger } from '@nestjs/common';
import type { LatLng } from '../../../../shared/types.js';
import { externalApiError } from '../common/api-exception.js';
import { dbErrorText } from '../common/db-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  segmentScoreQuery,
  type SegmentScoreRow,
} from './safety-score.query.js';

const DB_ERROR_MESSAGE =
  '안전점수를 잠시 계산하지 못했어요. 잠시 후 다시 시도해 주세요';

@Injectable()
export class SafetyScoreService {
  private readonly logger = new Logger(SafetyScoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 구간마다 원점수(반경 30m 안 시설의 가중치 합)를 `paths`와 같은 순서로 돌려준다. 후보 경로 전체를 쿼리 한 번에 센다.
   * 점수 없이 경로만 주면 모든 길이 위험으로 보여 오해를 사므로, DB가 없거나 실패하면 502 EXTERNAL_API_ERROR
   */
  async rawScores(paths: readonly LatLng[][]): Promise<number[]> {
    if (paths.length === 0) return [];
    if (!this.prisma.configured) throw externalApiError(DB_ERROR_MESSAGE);

    let rows: SegmentScoreRow[];
    try {
      rows = await this.prisma.$queryRaw<SegmentScoreRow[]>(
        segmentScoreQuery(paths),
      );
    } catch (e) {
      // 구간 좌표는 사용자 경로라 로그에 남기지 않는다
      this.logger.warn(`안전점수 조회 실패: ${dbErrorText(e)}`);
      throw externalApiError(DB_ERROR_MESSAGE);
    }
    const raws = paths.map(() => 0);
    for (const { i, raw } of rows) raws[i] = raw;
    return raws;
  }
}
