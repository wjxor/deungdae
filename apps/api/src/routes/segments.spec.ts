import { WALK_OK } from '../../test/fixtures/kakao-walk.js';
import type { LatLng } from '../../../../shared/types.js';
import { distanceM } from '../common/geo.js';
import { toWalkRoute } from '../walk/kakao-walk.convert.js';
import { splitPath } from './segments.js';

/** 경로를 따라간 길이 */
const lengthOf = (path: LatLng[]) =>
  path.slice(1).reduce((sum, p, i) => sum + distanceM(path[i], p), 0);

/** 위도만 바꿔 남북으로 곧게 뻗은 경로. 위도 0.0001° ≈ 11.1m */
const straight = (steps: number, stepDeg = 0.0001) =>
  Array.from({ length: steps + 1 }, (_, i) => ({
    lat: 36.33 + i * stepDeg,
    lng: 127.43,
  }));

describe('splitPath', () => {
  it('실제 응답 경로(약 248m)를 약 50m 구간 5개로 나눈다', () => {
    const { path } = toWalkRoute(WALK_OK);
    const pieces = splitPath(path);
    const total = lengthOf(path);

    expect(pieces).toHaveLength(Math.round(total / 50));
    for (const piece of pieces) {
      expect(piece.distanceM).toBeGreaterThanOrEqual(40);
      expect(piece.distanceM).toBeLessThanOrEqual(67);
      // 구간 안에서 길이 꺾이는 점도 그대로 들어 있어 실제 길이와 distanceM이 같다
      expect(Math.abs(lengthOf(piece.path) - piece.distanceM)).toBeLessThan(1);
    }
  });

  it('앞 구간의 끝 = 다음 구간의 시작, 처음·끝은 경로의 처음·끝', () => {
    const { path } = toWalkRoute(WALK_OK);
    const pieces = splitPath(path);
    expect(pieces[0].path[0]).toEqual(path[0]);
    expect(pieces.at(-1)!.path.at(-1)).toEqual(path.at(-1));
    for (let i = 1; i < pieces.length; i++) {
      expect(pieces[i].path[0]).toEqual(pieces[i - 1].path.at(-1));
    }
  });

  it('구간을 이으면 원래 경로의 점이 순서대로 모두 나온다', () => {
    const { path } = toWalkRoute(WALK_OK);
    const joined = splitPath(path).flatMap((p) => p.path);
    let found = 0;
    for (const p of joined) {
      if (
        found < path.length &&
        p.lat === path[found].lat &&
        p.lng === path[found].lng
      ) {
        found++;
      }
    }
    expect(found).toBe(path.length);
  });

  it('경계가 마침 점 위에 놓여도 같은 점을 두 번 넣지 않는다', () => {
    // 약 111m 직선을 2구간으로 나누면 가운데 경계(약 55.6m)가 5번째 점 위에 놓인다
    const path = straight(10);
    const pieces = splitPath(path);
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) {
      for (let i = 1; i < piece.path.length; i++) {
        expect(piece.path[i]).not.toEqual(piece.path[i - 1]);
      }
    }
  });

  it('75m보다 짧으면 구간 하나', () => {
    const path = straight(6); // 약 67m
    const pieces = splitPath(path);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].path).toEqual(path);
  });

  it('점이 2개보다 적으면 빈 목록', () => {
    expect(splitPath([{ lat: 36.33, lng: 127.43 }])).toEqual([]);
  });
});
