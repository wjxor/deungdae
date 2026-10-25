import { WALK_OK, walkFailed } from '../../test/fixtures/kakao-walk.js';
import { ApiException } from '../common/api-exception.js';
import { toWalkRoute } from './kakao-walk.convert.js';

/** toWalkRoute가 던진 에러의 HTTP 상태와 code */
function errorOf(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiException);
    const body = (e as ApiException).getResponse() as {
      error: { code: string };
    };
    return { status: (e as ApiException).getStatus(), code: body.error.code };
  }
  throw new Error('에러를 던지지 않음');
}

describe('toWalkRoute', () => {
  it('[경도, 위도]를 { lat, lng }로 바꾸고, step 경계에서 겹치는 점은 하나만 둔다', () => {
    const route = toWalkRoute(WALK_OK);
    expect(route.distanceM).toBe(342);
    expect(route.durationS).toBe(335);
    // 15개 + 3개 - 겹치는 1개
    expect(route.path).toHaveLength(17);
    expect(route.path[0]).toEqual({ lat: 36.33243907, lng: 127.43566206 });
    expect(route.path.at(-1)).toEqual({ lat: 36.33289675, lng: 127.43785638 });
  });

  it.each([
    ['SAME_POINT', 400, 'INVALID_INPUT'],
    ['TOO_FAR_AWAY', 400, 'TOO_FAR'],
    ['START_LINK_NOT_FOUND', 404, 'ORIGIN_UNREACHABLE'],
    ['END_LINK_NOT_FOUND', 404, 'DESTINATION_UNREACHABLE'],
    ['ROUTE_RESULT_NOT_FOUND', 404, 'ROUTE_NOT_FOUND'],
    ['TOO_MANY_SEARCH_LINK', 404, 'ROUTE_NOT_FOUND'],
    ['문서에_없는_값', 404, 'ROUTE_NOT_FOUND'],
  ])('status %s → %i %s', (status, httpStatus, code) => {
    expect(errorOf(() => toWalkRoute(walkFailed(status)))).toEqual({
      status: httpStatus,
      code,
    });
  });

  it('OK인데 좌표가 2개보다 적으면 ROUTE_NOT_FOUND', () => {
    const onePoint = {
      status: 'OK',
      route: {
        properties: { totalDistance: 0, totalTime: 0 },
        legs: [{ steps: [{ path: { points: [[127.43, 36.33]] } }] }],
      },
    } as Parameters<typeof toWalkRoute>[0];
    expect(errorOf(() => toWalkRoute(onePoint))).toEqual({
      status: 404,
      code: 'ROUTE_NOT_FOUND',
    });
  });
});
