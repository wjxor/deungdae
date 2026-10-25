import { Injectable } from '@nestjs/common';
import type {
  LatLng,
  Place,
  PlacesResponse,
} from '../../../../shared/types.js';
import { DAEJEON_RECT, isDaejeonAddress } from '../common/daejeon.js';
import { distanceM } from '../common/geo.js';
import {
  KakaoLocalClient,
  type KakaoAddressDoc,
  type KakaoKeywordDoc,
} from '../kakao/kakao-local.client.js';
import type { PlacesQuery } from './places.query.js';

/** 한 번에 돌려주는 최대 개수 (API.md 2장 — 카카오 키워드 검색 한 번의 최대) */
export const MAX_PLACES = 15;

/** 주소 검색은 지역 제한이 없어 전국 결과를 최대(30개)로 받은 뒤 대전만 남긴다 */
const ADDRESS_SEARCH_SIZE = 30;

@Injectable()
export class PlacesService {
  constructor(private readonly kakao: KakaoLocalClient) {}

  /**
   * 장소명이나 주소로 대전 안의 장소를 찾는다 (API.md 2장).
   * 키워드 검색을 먼저 부르고, 대전 안 결과가 없으면 주소 검색을 한 번 더 부른다
   */
  async search({ q, near }: PlacesQuery): Promise<PlacesResponse> {
    const keywordDocs = await this.kakao.searchKeyword(q, {
      rect: DAEJEON_RECT,
      near,
      size: MAX_PLACES,
    });
    const places = keywordDocs
      .filter((d) => isDaejeonAddress(d.address_name))
      .map(fromKeyword)
      .filter((p): p is Place => p !== null);
    if (places.length > 0) return { places };

    const addressDocs = await this.kakao.searchAddress(q, ADDRESS_SEARCH_SIZE);
    const addresses = addressDocs
      .filter((d) => isDaejeonAddress(d.address_name))
      .map(fromAddress)
      .filter((p): p is Place => p !== null);
    // 주소 검색은 거리순 정렬이 없어서 직접 정렬한다
    if (near) {
      addresses.sort(
        (a, b) => distanceM(near, a.location) - distanceM(near, b.location),
      );
    }
    return { places: addresses.slice(0, MAX_PLACES) };
  }
}

/** 카카오 x(경도)·y(위도) 문자열을 좌표로. 숫자가 아니면 null */
function toLatLng(x: string, y: string): LatLng | null {
  const lat = Number(y);
  const lng = Number(x);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** 키워드 검색 결과 → Place. 주소는 도로명을 먼저 쓰고, 없으면 지번 */
function fromKeyword(d: KakaoKeywordDoc): Place | null {
  const location = toLatLng(d.x, d.y);
  if (!location) return null;
  return {
    id: d.id,
    name: d.place_name,
    address: d.road_address_name || d.address_name,
    location,
  };
}

/** 주소 검색 결과 → Place. 카카오 장소 ID가 없어 주소로 id를 만들고, 이름은 주소와 같다 (API.md 2장) */
function fromAddress(d: KakaoAddressDoc): Place | null {
  const location = toLatLng(d.x, d.y);
  if (!location) return null;
  return {
    id: `address:${d.address_name}`,
    name: d.address_name,
    address: d.address_name,
    location,
  };
}
