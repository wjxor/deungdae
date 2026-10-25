import type { LatLng } from '../../../../shared/types.js';
import { invalidInput } from '../common/api-exception.js';
import { parseLatLng } from '../common/geo.js';

export type PlacesQuery = { q: string; near?: LatLng };

/**
 * `GET /api/places`의 쿼리를 검사한다 (API.md 2장).
 * `q`는 앞뒤 공백을 뺀 값이 비면 400, `near`는 있으면 `위도,경도` 형식이어야 한다.
 * 같은 이름을 두 번 보내면(`q=a&q=b`) Express가 배열로 주므로 문자열이 아니면 틀린 것으로 본다
 */
export function parsePlacesQuery(q: unknown, near: unknown): PlacesQuery {
  const keyword = typeof q === 'string' ? q.trim() : '';
  if (!keyword) throw invalidInput('검색어를 입력해 주세요');

  if (near === undefined) return { q: keyword };
  const location = typeof near === 'string' ? parseLatLng(near) : null;
  if (!location) throw invalidInput('near는 "위도,경도" 형식이어야 해요');
  return { q: keyword, near: location };
}
