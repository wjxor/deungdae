import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AddFavoritePlaceRequest,
  AddFavoriteRouteRequest,
  FavoritePlace,
  FavoriteRoute,
  FavoritesResponse,
  Place,
} from '../../../../shared/types.js';
import {
  ApiException,
  externalApiError,
  invalidInput,
  unauthorized,
} from '../common/api-exception.js';
import { dbErrorText } from '../common/db-error.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  deriveFavoriteKeys,
  favoriteKey,
  type FavoriteKeys,
  openJson,
  sealJson,
} from './favorite-crypto.js';

/** 회원당 장소·경로 각각 저장할 수 있는 개수 */
export const FAVORITE_LIMIT = 50;

const SERVER_FAILURE_MESSAGE =
  '즐겨찾기를 잠시 처리하지 못했어요. 잠시 후 다시 시도해 주세요';
const LIMIT_MESSAGE = `즐겨찾기는 ${FAVORITE_LIMIT}개까지 저장할 수 있어요`;
const EXPIRED_MESSAGE = '로그인이 만료됐어요. 다시 로그인해 주세요';
const ORDER = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];

/** 저장한 경로의 평문 (`payload`를 풀면 나오는 것) */
type RoutePayload = { name: string; origin: Place | null; destination: Place };

/**
 * 즐겨찾기 (API.md 5-1장, FR-012). 장소 정보는 AES-256-GCM으로 암호화해 저장하고(NFR-004),
 * 같은 곳은 HMAC 키로 한 번만 저장한다. 경로는 출발지·도착지만 저장해 웹이 불러올 때 다시 검색한다.
 * 키(`FAVORITES_KEY`)는 로컬과 배포 서버가 같아야 한다 — 같은 공용 DB를 써서, 다르면 서로 저장한 행을 못 읽는다
 */
@Injectable()
export class FavoritesService {
  private readonly logger = new Logger(FavoritesService.name);
  private readonly keys: FavoriteKeys | null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.keys = deriveFavoriteKeys(config.get<string>('FAVORITES_KEY'));
    if (!this.keys) {
      this.logger.warn(
        'FAVORITES_KEY가 없거나 32바이트 base64가 아니어서 즐겨찾기가 실패합니다. 저장소 루트 .env를 확인하세요',
      );
    }
  }

  /** 회원의 장소·경로 즐겨찾기 (저장한 순서). 풀리지 않는 행(다른 키로 저장 등)은 빼고 경고 로그만 남긴다 */
  async list(userId: number): Promise<FavoritesResponse> {
    const keys = this.ready();
    const [places, routes] = await this.db(() =>
      Promise.all([
        this.prisma.favoritePlace.findMany({
          where: { userId },
          orderBy: ORDER,
        }),
        this.prisma.favoriteRoute.findMany({
          where: { userId },
          orderBy: ORDER,
        }),
      ]),
    );
    return {
      places: places.flatMap((row) => {
        const place = this.open(keys, row.payload, row.id, isPlace);
        return place ? [{ id: row.id, place }] : [];
      }),
      routes: routes.flatMap((row) => {
        const route = this.open(keys, row.payload, row.id, isRoutePayload);
        return route ? [{ id: row.id, ...route }] : [];
      }),
    };
  }

  /** 장소를 저장한다. 이미 있으면 그 행을 `created: false`로 돌려준다. 50개가 차면 400 */
  async addPlace(
    userId: number,
    { place }: AddFavoritePlaceRequest,
  ): Promise<{ favorite: FavoritePlace; created: boolean }> {
    const keys = this.ready();
    const placeKey = favoriteKey(keys, userId, place.id);
    const find = () =>
      this.prisma.favoritePlace.findUnique({
        where: { userId_placeKey: { userId, placeKey } },
      });
    const row = await this.saveOnce(
      find,
      () => this.prisma.favoritePlace.count({ where: { userId } }),
      () =>
        this.prisma.favoritePlace.create({
          data: { userId, placeKey, payload: sealJson(keys, place) },
        }),
    );
    return { favorite: { id: row.id, place }, created: row.created };
  }

  /** 경로(출발지·도착지)를 저장한다. 출발지가 null이면 "현재 위치". 같은 출발·도착이 있으면 `created: false` */
  async addRoute(
    userId: number,
    req: AddFavoriteRouteRequest,
  ): Promise<{ favorite: FavoriteRoute; created: boolean }> {
    const keys = this.ready();
    // 웹의 routeFavoriteId와 같은 조합 — 출발지가 현재 위치면 "here"
    const routeKey = favoriteKey(
      keys,
      userId,
      `${req.origin?.id ?? 'here'}>${req.destination.id}`,
    );
    const payload: RoutePayload = {
      name: req.name,
      origin: req.origin,
      destination: req.destination,
    };
    const row = await this.saveOnce(
      () =>
        this.prisma.favoriteRoute.findUnique({
          where: { userId_routeKey: { userId, routeKey } },
        }),
      () => this.prisma.favoriteRoute.count({ where: { userId } }),
      () =>
        this.prisma.favoriteRoute.create({
          data: { userId, routeKey, payload: sealJson(keys, payload) },
        }),
    );
    return { favorite: { id: row.id, ...payload }, created: row.created };
  }

  /** 장소 즐겨찾기를 지운다. 그 회원의 행만 지우고, 없으면 아무 일도 하지 않는다 */
  async removePlace(userId: number, id: number): Promise<void> {
    this.ready();
    await this.db(() =>
      this.prisma.favoritePlace.deleteMany({ where: { id, userId } }),
    );
  }

  /** 경로 즐겨찾기를 지운다. 그 회원의 행만 지운다 */
  async removeRoute(userId: number, id: number): Promise<void> {
    this.ready();
    await this.db(() =>
      this.prisma.favoriteRoute.deleteMany({ where: { id, userId } }),
    );
  }

  /**
   * 이미 있으면 그 행, 없으면 개수를 보고 새로 만든다. 같은 ☆를 빠르게 두 번 눌러
   * 저장이 겹쳐 UNIQUE 위반(P2002)이 나면 먼저 들어간 행을 돌려준다
   */
  private async saveOnce(
    find: () => Promise<{ id: number } | null>,
    count: () => Promise<number>,
    create: () => Promise<{ id: number }>,
  ): Promise<{ id: number; created: boolean }> {
    const existing = await this.db(find);
    if (existing) return { id: existing.id, created: false };
    if ((await this.db(count)) >= FAVORITE_LIMIT) {
      throw invalidInput(LIMIT_MESSAGE);
    }
    try {
      return { id: (await create()).id, created: true };
    } catch (e) {
      if (prismaCode(e) === 'P2002') {
        const row = await this.db(find);
        if (row) return { id: row.id, created: false };
      }
      // 탈퇴한 회원의 토큰(7일)이 남아 있으면 users 행이 없어 FK 위반
      if (prismaCode(e) === 'P2003') throw unauthorized(EXPIRED_MESSAGE);
      throw this.dbFailure(e);
    }
  }

  /** 키와 DB가 준비됐는지 보고 키를 돌려준다. 아니면 502 */
  private ready(): FavoriteKeys {
    if (!this.keys || !this.prisma.configured) {
      throw externalApiError(SERVER_FAILURE_MESSAGE);
    }
    return this.keys;
  }

  /** 행 하나를 풀어 모양을 확인한다. 안 되면 null과 경고 로그 (행 id만 남긴다) */
  private open<T>(
    keys: FavoriteKeys,
    payload: Uint8Array,
    rowId: number,
    is: (value: unknown) => value is T,
  ): T | null {
    const value = openJson(keys, payload);
    if (is(value)) return value;
    this.logger.warn(
      `즐겨찾기 ${rowId}번을 풀지 못해 목록에서 뺐습니다 (FAVORITES_KEY가 저장할 때와 다를 수 있음)`,
    );
    return null;
  }

  /** DB 실패는 502로 바꾼다. 우리가 던진 ApiException은 그대로 */
  private async db<T>(query: () => Promise<T>): Promise<T> {
    try {
      return await query();
    } catch (e) {
      throw this.dbFailure(e);
    }
  }

  /** 로그를 남기고 502 */
  private dbFailure(e: unknown): ApiException {
    if (e instanceof ApiException) return e;
    this.logger.warn(`즐겨찾기 DB 실패: ${dbErrorText(e)}`);
    return externalApiError(SERVER_FAILURE_MESSAGE);
  }
}

/** Prisma 에러 코드 (P2002 UNIQUE 위반, P2003 FK 위반 등). 아니면 undefined */
function prismaCode(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** 저장해 둔 장소 JSON 모양인지 */
function isPlace(value: unknown): value is Place {
  const v = value as Partial<Place> | null;
  return (
    typeof v?.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.address === 'string' &&
    typeof v.location?.lat === 'number' &&
    typeof v.location.lng === 'number'
  );
}

/** 저장해 둔 경로 JSON 모양인지 */
function isRoutePayload(value: unknown): value is RoutePayload {
  const v = value as Partial<RoutePayload> | null;
  return (
    typeof v?.name === 'string' &&
    (v.origin === null || isPlace(v.origin)) &&
    isPlace(v.destination)
  );
}
