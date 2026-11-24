import { Injectable, Logger } from '@nestjs/common';
import type {
  FacilityCounts,
  LatLng,
  ScoreFacilityType,
} from '../../../../shared/types.js';
import { externalApiError } from '../common/api-exception.js';
import { dbErrorText } from '../common/db-error.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { applyReportPenalty } from './safety.js';
import {
  emptyFacilityCounts,
  reportedSegmentQuery,
  routeFacilityQuery,
  SCORE_FACILITY_TYPES,
  segmentScoreQuery,
  type ReportedSegmentRow,
  type RouteFacilityRow,
  type SegmentScoreRow,
} from './safety-score.query.js';
import {
  waypointCandidateQuery,
  type WaypointQueryInput,
} from './waypoint.query.js';
import type { WaypointCandidate } from './waypoints.js';

const DB_ERROR_MESSAGE =
  '안전점수를 잠시 계산하지 못했어요. 잠시 후 다시 시도해 주세요';

@Injectable()
export class SafetyScoreService {
  private readonly logger = new Logger(SafetyScoreService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 구간마다 원점수(반경 30m 안 시설의 가중치 합)를 `paths`와 같은 순서로 돌려준다. 후보 경로 전체를 쿼리 한 번에 센다.
   * 제보가 쌓인 구간(FR-010)은 원점수에서 5를 한 번 뺀다(0 아래면 0). 감점할 구간은 따로 고르고 시설 쿼리와 동시에 돌린다.
   * 점수 없이 경로만 주면 모든 길이 위험으로 보여 오해를 사므로, DB가 없거나 둘 중 하나라도 실패하면 502 EXTERNAL_API_ERROR
   */
  async rawScores(paths: readonly LatLng[][]): Promise<number[]> {
    if (paths.length === 0) return [];
    const [rows, reported] = await Promise.all([
      this.query<SegmentScoreRow>(
        segmentScoreQuery(paths),
        '안전점수 조회 실패',
      ),
      this.query<ReportedSegmentRow>(
        reportedSegmentQuery(paths),
        '제보 감점 조회 실패',
      ),
    ]);
    const raws = paths.map(() => 0);
    for (const { i, raw } of rows) raws[i] = raw;
    for (const { i } of reported) raws[i] = applyReportPenalty(raws[i]);
    return raws;
  }

  /**
   * 경로마다 반경 30m 안 시설의 종류별 개수를 경로 순서대로 돌려준다 (경로 화면 펼침, FR-007).
   * `segmentsByRoute[k]`는 경로 k의 구간 선들이다(점수에 쓰는 구간 그대로 — 이으면 경로 선이다).
   * 5종 키가 늘 있고 없는 종류는 0, 5종 밖의 종류는 버린다. 점수와 같은 지점 규칙이다.
   * DB가 없거나 실패하면 점수와 같이 502 EXTERNAL_API_ERROR
   */
  async facilityCounts(
    segmentsByRoute: readonly LatLng[][][],
  ): Promise<FacilityCounts[]> {
    if (segmentsByRoute.length === 0) return [];
    const rows = await this.query<RouteFacilityRow>(
      routeFacilityQuery(segmentsByRoute),
      '시설 개수 조회 실패',
    );
    const counts = segmentsByRoute.map(() => emptyFacilityCounts());
    for (const { i, type, n } of rows) {
      if (isScoreFacilityType(type)) counts[i][type] = n;
    }
    return counts;
  }

  /**
   * A 보강 경유지 후보 지점 — 기준 경로 근처에서 밀집도가 높은 순 (FR-006, `waypointCandidateQuery`).
   * DB가 없거나 실패하면 502지만, 경로 검색은 이 실패를 B안 결과로 넘긴다 (`RoutesService`)
   */
  async waypointCandidates(
    input: WaypointQueryInput,
  ): Promise<WaypointCandidate[]> {
    return this.query<WaypointCandidate>(
      waypointCandidateQuery(input),
      '경유지 후보 조회 실패',
    );
  }

  /** DB 미설정·쿼리 실패를 502로 바꾼다. 쿼리에 든 좌표는 사용자 경로라 로그에 남기지 않는다 */
  private async query<T>(sql: Prisma.Sql, failLog: string): Promise<T[]> {
    if (!this.prisma.configured) throw externalApiError(DB_ERROR_MESSAGE);
    try {
      return await this.prisma.$queryRaw<T[]>(sql);
    } catch (e) {
      this.logger.warn(`${failLog}: ${dbErrorText(e)}`);
      throw externalApiError(DB_ERROR_MESSAGE);
    }
  }
}

/** DB의 시설 종류가 응답에 담는 5종 중 하나인지 */
function isScoreFacilityType(type: string): type is ScoreFacilityType {
  return (SCORE_FACILITY_TYPES as readonly string[]).includes(type);
}
