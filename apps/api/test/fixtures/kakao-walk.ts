import type { KakaoWalkResponse } from '../../src/walk/kakao-walk.client.js';

/** 대전역 부근 출발 (실험 쌍 daejeon-station-woosong, scripts/route-pairs.json) */
export const DAEJEON_STATION = { lat: 36.332294, lng: 127.434645 };
/** 우송대학교 서캠퍼스 부근 */
export const WOOSONG = { lat: 36.33709, lng: 127.44509 };

/**
 * 카카오 도보 경로 실제 응답(2026-09-29, SHORTEST)의 앞 step 2개.
 * 첫 step의 끝점이 둘째 step의 첫 점으로 다시 나온다. 거리·시간은 두 step의 합
 */
export const WALK_OK: KakaoWalkResponse = {
  status: 'OK',
  route: {
    properties: { totalDistance: 342, totalTime: 335 },
    legs: [
      {
        steps: [
          {
            path: {
              points: [
                [127.43566206, 36.33243907],
                [127.4357472, 36.33242309],
                [127.4358369, 36.33243383],
                [127.43592113, 36.33248569],
                [127.43630598, 36.33266693],
                [127.43645628, 36.33277092],
                [127.43647984, 36.33275055],
                [127.43647194, 36.33264556],
                [127.43655173, 36.33253457],
                [127.43662592, 36.33248079],
                [127.43671205, 36.33244725],
                [127.43678176, 36.33243105],
                [127.43684009, 36.33243833],
                [127.43752486, 36.33276757],
                [127.43759097, 36.33276283],
              ],
            },
          },
          {
            path: {
              points: [
                [127.43759097, 36.33276283],
                [127.43762953, 36.33281281],
                [127.43785638, 36.33289675],
              ],
            },
          },
        ],
      },
    ],
  },
};

/** 경로를 못 찾은 응답 — HTTP 200에 status로 온다 (2026-10-25 실제 호출로 확인) */
export function walkFailed(status: string): KakaoWalkResponse {
  return {
    status,
    route: { properties: { totalDistance: 0, totalTime: 0 }, legs: [] },
  };
}
