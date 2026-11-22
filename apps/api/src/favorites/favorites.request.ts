import type {
  AddFavoritePlaceRequest,
  AddFavoriteRouteRequest,
  Place,
} from '../../../../shared/types.js';
import { invalidInput, outOfArea } from '../common/api-exception.js';
import { isInDaejeonRect } from '../common/daejeon.js';
import { readLatLng } from '../common/geo.js';

/** 길이 상한 — 정상 장소는 훨씬 짧고, 남이 큰 값을 넣어 DB를 채우지 못하게 막는 것 */
const MAX_ID = 200;
const MAX_NAME = 100;
const MAX_ADDRESS = 200;
const MAX_ROUTE_NAME = 200;
/** `favorite_*.id`는 PostgreSQL integer라 이보다 큰 값은 있을 수 없다 */
const MAX_ROW_ID = 2_147_483_647;

const BAD_FORMAT = '즐겨찾기 형식이 올바르지 않아요';
const OUT_OF_AREA_MESSAGE =
  '대전 안의 장소만 즐겨찾기할 수 있어요. 대전 안에서 골라 주세요';

/**
 * `POST /favorites/places` 본문을 검사한다 (API.md 5-1장 `AddFavoritePlaceRequest`).
 * 모양·길이가 틀리면 400 INVALID_INPUT, 대전 사각형 밖이면 400 OUT_OF_AREA — 불러와도 경로를 못 찾는 곳이라서
 */
export function parseAddPlaceRequest(body: unknown): AddFavoritePlaceRequest {
  return { place: readPlace(asRecord(body).place) };
}

/**
 * `POST /favorites/routes` 본문을 검사한다 (API.md 5-1장 `AddFavoriteRouteRequest`).
 * origin은 장소이거나 null("현재 위치")이어야 하고, 빠지면(undefined) 틀린 것으로 본다
 */
export function parseAddRouteRequest(body: unknown): AddFavoriteRouteRequest {
  const { name, origin, destination } = asRecord(body);
  if (!isText(name, MAX_ROUTE_NAME) || origin === undefined) {
    throw invalidInput(BAD_FORMAT);
  }
  return {
    name,
    origin: origin === null ? null : readPlace(origin),
    destination: readPlace(destination),
  };
}

/** 주소의 `:id` — 양의 정수 문자열만 받는다. 아니면 400 INVALID_INPUT */
export function parseFavoriteId(raw: string): number {
  const id = /^[1-9]\d*$/.test(raw) ? Number(raw) : NaN;
  if (!(id <= MAX_ROW_ID))
    throw invalidInput('즐겨찾기 번호가 올바르지 않아요');
  return id;
}

/** 본문의 장소를 Place 네 필드만 남겨 읽는다. 주소는 빈 문자열도 받는다 (지도에서 고른 곳) */
function readPlace(value: unknown): Place {
  const { id, name, address, location } = asRecord(value);
  const latLng = readLatLng(location);
  if (
    !isText(id, MAX_ID) ||
    !isText(name, MAX_NAME) ||
    typeof address !== 'string' ||
    address.length > MAX_ADDRESS ||
    !latLng
  ) {
    throw invalidInput(BAD_FORMAT);
  }
  if (!isInDaejeonRect(latLng)) throw outOfArea(OUT_OF_AREA_MESSAGE);
  return { id, name, address, location: latLng };
}

/** 비지 않았고 상한 이하인 문자열인지 */
function isText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

/** 객체면 그대로, 아니면 빈 객체 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
