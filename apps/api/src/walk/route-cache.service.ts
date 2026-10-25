import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { LatLng } from '../../../../shared/types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** 캐시 유지 시간 (ERD `route_cache.expires_at` 초안 24시간) */
const TTL_MS = 24 * 60 * 60 * 1000;

/** 캐시 키를 만들 때 좌표를 자르는 자릿수 (ERD 초안: 소수점 4자리, 약 10m) */
export const COORD_DIGITS = 4;

export type RouteCacheKeyInput = {
  provider: string;
  routeMode: string;
  origin: LatLng;
  destination: LatLng;
  waypoints: LatLng[];
};

export type RouteCacheEntry = {
  key: string;
  provider: string;
  routeMode: string;
  /** 경로 API 원본 응답 */
  response: unknown;
  distanceM: number;
  durationS: number;
};

/** 좌표를 소수점 4자리로 반올림한다. 캐시 키와 실제 경로 API 호출에 같은 값을 쓴다 */
export function roundLatLng({ lat, lng }: LatLng): LatLng {
  return {
    lat: Number(lat.toFixed(COORD_DIGITS)),
    lng: Number(lng.toFixed(COORD_DIGITS)),
  };
}

/**
 * `route_cache.cache_key` — 공급자·탐색 옵션·출발·도착·경유지를 이은 문자열의 SHA-256 (ERD).
 * 좌표는 해시로만 남아 키를 봐도 위치를 알 수 없다
 */
export function routeCacheKey(input: RouteCacheKeyInput): string {
  const coord = (p: LatLng) =>
    `${p.lat.toFixed(COORD_DIGITS)},${p.lng.toFixed(COORD_DIGITS)}`;
  const normalized = [
    input.provider,
    input.routeMode,
    coord(input.origin),
    coord(input.destination),
    input.waypoints.map(coord).join(';'),
  ].join('|');
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * 경로 API 응답 캐시 (ERD `route_cache`). 카카오 도보 경로는 하루 1,000건 무료라 같은 요청은 다시 부르지 않는다.
 * DB가 없거나 안 되면 캐시 없이 동작한다 (경로 검색 자체는 실패시키지 않음)
 */
@Injectable()
export class RouteCacheService {
  private readonly logger = new Logger(RouteCacheService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 만료 전인 캐시 응답. 없거나, 만료됐거나, DB가 안 되면 null */
  async get(key: string): Promise<unknown> {
    if (!this.prisma.configured) return null;
    try {
      const row = await this.prisma.routeCache.findUnique({
        where: { cacheKey: key },
        select: { response: true, expiresAt: true },
      });
      if (!row || row.expiresAt.getTime() <= Date.now()) return null;
      return row.response;
    } catch (e) {
      this.logger.warn(`경로 캐시 읽기 실패: ${dbErrorText(e)}`);
      return null;
    }
  }

  /** 응답을 24시간 저장하고, 만료된 행을 지운다 (ERD: 만료된 행은 지운다 — NFR-004) */
  async put(entry: RouteCacheEntry): Promise<void> {
    if (!this.prisma.configured) return;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL_MS);
    const data = {
      response: entry.response as Prisma.InputJsonValue,
      distanceM: entry.distanceM,
      durationS: entry.durationS,
      expiresAt,
    };
    try {
      await Promise.all([
        this.prisma.routeCache.upsert({
          where: { cacheKey: entry.key },
          create: {
            cacheKey: entry.key,
            provider: entry.provider,
            routeMode: entry.routeMode,
            ...data,
          },
          update: { ...data, createdAt: now },
        }),
        this.prisma.routeCache.deleteMany({
          where: { expiresAt: { lt: now } },
        }),
      ]);
    } catch (e) {
      this.logger.warn(`경로 캐시 저장 실패: ${dbErrorText(e)}`);
    }
  }
}

/**
 * 로그에 남길 DB 에러 문장. Prisma 에러 본문에는 쿼리 값(경로 응답 속 좌표)이 들어갈 수 있어
 * 첫 줄만 남긴다
 */
function dbErrorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const code = (e as { code?: unknown }).code;
  const firstLine = e.message.split('\n').find((line) => line.trim() !== '');
  return [e.name, typeof code === 'string' ? code : '', firstLine ?? '']
    .filter(Boolean)
    .join(' ');
}
