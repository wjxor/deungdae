import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { RouteSearchResponse } from '../../../../shared/types.js';
import { parseRouteSearchRequest } from './route-search.request.js';
import { RoutesService } from './routes.service.js';

@Controller('routes')
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  /** POST /api/routes/search (API.md 3장). 새로 만드는 것이 없어 201이 아니라 200 */
  @Post('search')
  @HttpCode(HttpStatus.OK)
  search(@Body() body: unknown): Promise<RouteSearchResponse> {
    return this.routes.search(parseRouteSearchRequest(body));
  }
}
