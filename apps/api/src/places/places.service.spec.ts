import { DAEJEON_RECT } from '../common/daejeon.js';
import type {
  KakaoAddressDoc,
  KakaoKeywordDoc,
  KakaoLocalClient,
} from '../kakao/kakao-local.client.js';
import { MAX_PLACES, PlacesService } from './places.service.js';

/** 테스트용 가짜 카카오. 키워드·주소 검색 결과만 정해 둔다 */
function fakeKakao(
  keyword: KakaoKeywordDoc[],
  address: KakaoAddressDoc[] = [],
) {
  const searchKeyword = vi.fn(() => Promise.resolve(keyword));
  const searchAddress = vi.fn(() => Promise.resolve(address));
  const kakao = { searchKeyword, searchAddress } as unknown as KakaoLocalClient;
  return { service: new PlacesService(kakao), searchKeyword, searchAddress };
}

// 2026-10-25 실제 카카오 응답에서 가져온 값
const CNU: KakaoKeywordDoc = {
  id: '12520707',
  place_name: '충남대학교 대덕캠퍼스',
  address_name: '대전 유성구 궁동 220',
  road_address_name: '대전 유성구 대학로 99',
  x: '127.34687598476853',
  y: '36.36881378319206',
};
const SEJONG: KakaoKeywordDoc = {
  id: '17821544',
  place_name: '세종특별자치시청',
  address_name: '세종특별자치시 보람동 626-5',
  road_address_name: '세종특별자치시 한누리대로 2130',
  x: '127.28919531800284',
  y: '36.48006310909889',
};
const PARKING: KakaoKeywordDoc = {
  id: '1786467738',
  place_name: '유성구청 주차장',
  address_name: '대전 유성구 어은동 115-3',
  road_address_name: '',
  x: '127.3577',
  y: '36.3622',
};
const ROAD_99_DONGGU: KakaoAddressDoc = {
  address_name: '대전 동구 대학로 99',
  x: '127.457441375768',
  y: '36.3386187681464',
};
const ROAD_99_YUSEONG: KakaoAddressDoc = {
  address_name: '대전 유성구 대학로 99',
  x: '127.341662059729',
  y: '36.3683281154744',
};
const ROAD_99_YEONGDONG: KakaoAddressDoc = {
  address_name: '충북 영동군 영동읍 대학로 99',
  x: '127.78029711923',
  y: '36.1864589672777',
};

describe('PlacesService', () => {
  it('키워드 검색 결과를 Place로 바꾼다 (주소는 도로명 먼저)', async () => {
    const { service } = fakeKakao([CNU]);
    expect(await service.search({ q: '충남대학교' })).toEqual({
      places: [
        {
          id: '12520707',
          name: '충남대학교 대덕캠퍼스',
          address: '대전 유성구 대학로 99',
          location: { lat: 36.36881378319206, lng: 127.34687598476853 },
        },
      ],
    });
  });

  it('도로명 주소가 없으면 지번 주소', async () => {
    const { service } = fakeKakao([PARKING]);
    const { places } = await service.search({ q: '주차장' });
    expect(places[0].address).toBe('대전 유성구 어은동 115-3');
  });

  it('대전 사각형으로 찾고, near가 있으면 넘긴다', async () => {
    const { service, searchKeyword } = fakeKakao([CNU]);
    const near = { lat: 36.36, lng: 127.34 };
    await service.search({ q: '충남대학교', near });
    expect(searchKeyword).toHaveBeenCalledWith('충남대학교', {
      rect: DAEJEON_RECT,
      near,
      size: MAX_PLACES,
    });
  });

  it('사각형 안이라도 대전 밖 주소는 뺀다 (세종시청)', async () => {
    const { service, searchAddress } = fakeKakao([SEJONG, CNU]);
    const { places } = await service.search({ q: '시청' });
    expect(places.map((p) => p.id)).toEqual(['12520707']);
    expect(searchAddress).not.toHaveBeenCalled();
  });

  it('키워드 결과가 없으면 주소 검색으로 찾고, 이름은 주소와 같다', async () => {
    const { service, searchAddress } = fakeKakao(
      [],
      [ROAD_99_YEONGDONG, ROAD_99_YUSEONG],
    );
    const { places } = await service.search({ q: '대학로 99' });
    expect(searchAddress).toHaveBeenCalledWith('대학로 99', 30);
    expect(places).toEqual([
      {
        id: 'address:대전 유성구 대학로 99',
        name: '대전 유성구 대학로 99',
        address: '대전 유성구 대학로 99',
        location: { lat: 36.3683281154744, lng: 127.341662059729 },
      },
    ]);
  });

  it('키워드 결과가 전부 대전 밖이어도 주소 검색으로 넘어간다', async () => {
    const { service, searchAddress } = fakeKakao([SEJONG], []);
    expect(await service.search({ q: '세종시청' })).toEqual({ places: [] });
    expect(searchAddress).toHaveBeenCalledOnce();
  });

  it('주소 결과는 near에서 가까운 순으로 직접 정렬한다', async () => {
    const { service } = fakeKakao([], [ROAD_99_DONGGU, ROAD_99_YUSEONG]);
    const nearCnu = { lat: 36.3664, lng: 127.3446 };
    const { places } = await service.search({ q: '대학로 99', near: nearCnu });
    expect(places.map((p) => p.address)).toEqual([
      '대전 유성구 대학로 99',
      '대전 동구 대학로 99',
    ]);
  });

  it(`주소 결과도 최대 ${MAX_PLACES}개`, async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      address_name: `대전 서구 둔산동 ${i + 1}`,
      x: '127.38',
      y: '36.35',
    }));
    const { service } = fakeKakao([], many);
    const { places } = await service.search({ q: '둔산동' });
    expect(places).toHaveLength(MAX_PLACES);
  });

  it('좌표가 숫자가 아닌 결과는 뺀다', async () => {
    const { service } = fakeKakao([{ ...CNU, x: '', y: 'abc' }, PARKING]);
    const { places } = await service.search({ q: '유성' });
    expect(places.map((p) => p.id)).toEqual([PARKING.id]);
  });
});
