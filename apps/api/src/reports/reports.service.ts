import { Injectable, Logger } from '@nestjs/common';
import type { Report } from '../../../../shared/types.js';
import { externalApiError, unauthorized } from '../common/api-exception.js';
import { dbErrorText } from '../common/db-error.js';
import { toKstIso } from '../common/time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { NewReport } from './reports.request.js';

/** `INSERT … RETURNING` 한 행 */
type InsertedRow = { id: number; createdAt: Date };

const SERVER_FAILURE_MESSAGE =
  '제보를 잠시 저장하지 못했어요. 잠시 후 다시 시도해 주세요';
const EXPIRED_MESSAGE = '로그인이 만료됐어요. 다시 로그인해 주세요';

/**
 * 위험 제보 (API.md 6장, FR-009). 회원만 쓰고 사진은 받지 않는다 (2026-11-23 PR #93).
 * 구간 점수 반영(FR-010)은 경로 검색이 요청마다 DB에서 센다 (`routes/safety-score.query.ts`의 `reportedSegmentQuery`).
 * 그때 사람 수를 세는 익명 제보자 키(`reporter_key`)는 INSERT에 넣지 않고 DB 트리거가 작성자의 `users.report_key`로 채운다
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 제보를 저장한다. 회원 행이 없으면(탈퇴한 회원의 토큰이 7일 안에 남은 경우) 저장하지 않고 401,
   * DB가 없거나 실패하면 502 EXTERNAL_API_ERROR
   */
  async create(userId: number, report: NewReport): Promise<Report> {
    if (!this.prisma.configured) throw externalApiError(SERVER_FAILURE_MESSAGE);
    const { location, type, description } = report;

    let rows: InsertedRow[];
    try {
      // users에서 고르는 INSERT라 회원이 없으면 0행이다 — FK 위반 에러 대신 401로 답하려고
      // (즐겨찾기는 Prisma create의 P2003으로 보지만, 위치가 geography라 여기는 $queryRaw다)
      rows = await this.prisma.$queryRaw<InsertedRow[]>`
        INSERT INTO reports (user_id, location, type, description)
        SELECT id,
               ST_SetSRID(ST_MakePoint(${location.lng}::float8, ${location.lat}::float8), 4326)::geography,
               ${type}::text,
               ${description}::text
        FROM users
        WHERE id = ${userId}::int
        RETURNING id, created_at AS "createdAt"`;
    } catch (e) {
      // 제보 위치는 회원과 이어진 정보라 로그에 남기지 않는다
      this.logger.warn(`제보 저장 실패: ${dbErrorText(e)}`);
      throw externalApiError(SERVER_FAILURE_MESSAGE);
    }

    const row = rows[0];
    if (!row) throw unauthorized(EXPIRED_MESSAGE);
    return {
      id: row.id,
      location,
      type,
      description,
      createdAt: toKstIso(row.createdAt),
    };
  }
}
