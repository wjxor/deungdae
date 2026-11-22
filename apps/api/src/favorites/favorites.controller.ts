import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type {
  FavoritePlaceResponse,
  FavoriteRouteResponse,
  FavoritesResponse,
} from '../../../../shared/types.js';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js';
import {
  parseAddPlaceRequest,
  parseAddRouteRequest,
  parseFavoriteId,
} from './favorites.request.js';
import { FavoritesService } from './favorites.service.js';

/** 즐겨찾기 (API.md 5-1장, FR-012). 모두 로그인이 필요하다 */
@Controller('favorites')
@UseGuards(AuthGuard)
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  /** GET /api/favorites — 장소·경로를 한 번에 (목록 시트 탭이 두 개라서) */
  @Get()
  list(@Req() req: AuthedRequest): Promise<FavoritesResponse> {
    return this.favorites.list(req.userId);
  }

  /** POST /api/favorites/places — 새로 저장하면 201, 이미 있던 곳이면 200 */
  @Post('places')
  async addPlace(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FavoritePlaceResponse> {
    const { favorite, created } = await this.favorites.addPlace(
      req.userId,
      parseAddPlaceRequest(body),
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return { place: favorite };
  }

  /** DELETE /api/favorites/places/:id — 지울 것이 없어도 204 */
  @Delete('places/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePlace(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    return this.favorites.removePlace(req.userId, parseFavoriteId(id));
  }

  /** POST /api/favorites/routes — 출발지·도착지만 저장. 새로 저장하면 201, 같은 출발·도착이 있으면 200 */
  @Post('routes')
  async addRoute(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FavoriteRouteResponse> {
    const { favorite, created } = await this.favorites.addRoute(
      req.userId,
      parseAddRouteRequest(body),
    );
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return { route: favorite };
  }

  /** DELETE /api/favorites/routes/:id — 지울 것이 없어도 204 */
  @Delete('routes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRoute(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    return this.favorites.removeRoute(req.userId, parseFavoriteId(id));
  }
}
