import { HttpStatus } from '@nestjs/common';
import type { LatLng } from '../../../../shared/types.js';
import { ApiException, invalidInput } from '../common/api-exception.js';
import { distanceM, readLatLng } from '../common/geo.js';

/**
 * 시설 조회 범위의 가로·세로 상한(m). API.md 4장 — PR #14에서 2km → 4km (폰 레벨 5·PC 레벨 4 화면이 2km를 넘어서).
 * 프론트 `FacilityLayer`의 `BBOX_MAX_M`과 같은 값이어야 한다
 */
export const BBOX_MAX_M = 4000;

/** 지도 범위. 남서·북동 모서리 */
export type Bbox = { sw: LatLng; ne: LatLng };

/**
 * `GET /api/facilities`의 `bbox`(`남서 위도,경도,북동 위도,경도`)를 검사한다 (API.md 4장).
 * 형식이 틀리거나 남서가 북동보다 북쪽·동쪽이면 400 INVALID_INPUT,
 * 가로·세로 중 하나라도 4km를 넘으면 400 BBOX_TOO_LARGE
 */
export function parseBboxQuery(bbox: unknown): Bbox {
  const parts =
    typeof bbox === 'string' ? bbox.split(',').map((s) => s.trim()) : [];
  const nums =
    parts.length === 4 && parts.every((s) => s !== '') ? parts.map(Number) : [];
  const sw = readLatLng({ lat: nums[0], lng: nums[1] });
  const ne = readLatLng({ lat: nums[2], lng: nums[3] });
  if (!sw || !ne || sw.lat > ne.lat || sw.lng > ne.lng) {
    throw invalidInput(
      'bbox는 "남서 위도,경도,북동 위도,경도" 형식이어야 해요',
    );
  }
  if (bboxSpanM({ sw, ne }) > BBOX_MAX_M) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      'BBOX_TOO_LARGE',
      '조회 범위가 너무 넓어요. 지도를 더 확대해 주세요',
    );
  }
  return { sw, ne };
}

/**
 * bbox의 가로·세로 중 긴 쪽(m). 프론트 `FacilityLayer`와 같은 식이다 (가로는 남쪽 변, 세로는 서쪽 변).
 * 식이 다르면 프론트가 4km 안이라고 보낸 범위를 서버가 거절할 수 있다
 */
export function bboxSpanM({ sw, ne }: Bbox): number {
  return Math.max(
    distanceM(sw, { lat: sw.lat, lng: ne.lng }),
    distanceM(sw, { lat: ne.lat, lng: sw.lng }),
  );
}
