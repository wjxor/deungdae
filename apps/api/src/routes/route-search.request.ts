import type { Mode, RouteSearchRequest } from '../../../../shared/types.js';
import { invalidInput } from '../common/api-exception.js';
import { readLatLng } from '../common/geo.js';

const MODES: readonly Mode[] = ['day', 'night'];

/**
 * `POST /routes/search` 본문을 검사한다 (API.md 3장 `RouteSearchRequest`).
 * 형식이 틀리면 400 INVALID_INPUT. 대전 안인지는 RoutesService가 본다
 */
export function parseRouteSearchRequest(body: unknown): RouteSearchRequest {
  const { origin, destination, mode } = (
    typeof body === 'object' && body !== null ? body : {}
  ) as Record<string, unknown>;

  const start = readLatLng(origin);
  if (!start) throw invalidInput('출발지 좌표가 없거나 형식이 틀렸어요');
  const end = readLatLng(destination);
  if (!end) throw invalidInput('도착지 좌표가 없거나 형식이 틀렸어요');
  if (!MODES.includes(mode as Mode)) {
    throw invalidInput('mode는 "day" 또는 "night"여야 해요');
  }
  return { origin: start, destination: end, mode: mode as Mode };
}
