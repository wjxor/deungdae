import { Controller, Get, Query } from '@nestjs/common';
import type { PlacesResponse } from '../../../../shared/types.js';
import { parsePlacesQuery } from './places.query.js';
import { PlacesService } from './places.service.js';

@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  /** GET /api/places?q=충남대학교&near=36.36,127.34 — 장소·주소 검색 (FR-003) */
  @Get()
  search(
    @Query('q') q: unknown,
    @Query('near') near: unknown,
  ): Promise<PlacesResponse> {
    return this.places.search(parsePlacesQuery(q, near));
  }
}
