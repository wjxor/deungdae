import { Controller, Get, Query } from '@nestjs/common';
import type { FacilitiesResponse } from '../../../../shared/types.js';
import { parseBboxQuery } from './facilities.query.js';
import { FacilitiesService } from './facilities.service.js';

@Controller('facilities')
export class FacilitiesController {
  constructor(private readonly facilities: FacilitiesService) {}

  /** GET /api/facilities?bbox=36.35,127.33,36.37,127.36 — 지도 범위 안의 안전시설 (FR-002) */
  @Get()
  find(@Query('bbox') bbox: unknown): Promise<FacilitiesResponse> {
    return this.facilities.findInBbox(parseBboxQuery(bbox));
  }
}
