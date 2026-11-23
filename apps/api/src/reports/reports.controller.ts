import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { ReportResponse } from '../../../../shared/types.js';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js';
import { parseCreateReportRequest } from './reports.request.js';
import { ReportsService } from './reports.service.js';

/**
 * 위험 제보 (API.md 6장, FR-009). 회원만 제보한다 (2026-11-23 PR #93).
 * 지도에 남의 제보를 보여 주는 `GET /reports`는 요구사항·화면에 없어 만들지 않았다
 */
@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** POST /api/reports — 제보를 저장하고 201 */
  @Post()
  async create(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<ReportResponse> {
    const report = await this.reports.create(
      req.userId,
      parseCreateReportRequest(body),
    );
    return { report };
  }
}
