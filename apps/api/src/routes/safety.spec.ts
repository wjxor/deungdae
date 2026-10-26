import {
  pickSafe,
  SAFE_MAX_DETOUR,
  SAFE_MIN_GAIN,
  toRouteScore,
  toSafetyLevel,
  toSegmentScore,
} from './safety.js';

describe('toSegmentScore', () => {
  it.each([
    [-1, 0],
    [0, 0],
    [1, 29],
    [2, 46],
    [3, 58],
    [4, 67],
    [5, 75],
    [8, 92],
    [10, 100],
    [27, 100],
  ])('원점수 %i → %i점', (raw, score) => {
    expect(toSegmentScore(raw)).toBe(score);
  });
});

describe('toRouteScore', () => {
  it('구간 점수의 거리 가중 평균 (반올림)', () => {
    expect(
      toRouteScore([
        { distanceM: 50, safetyScore: 100 },
        { distanceM: 50, safetyScore: 0 },
        { distanceM: 100, safetyScore: 75 },
      ]),
    ).toBe(63); // (5000 + 0 + 7500) / 200 = 62.5
  });

  it('구간이 없으면 0, 거리가 모두 0이면 단순 평균', () => {
    expect(toRouteScore([])).toBe(0);
    expect(
      toRouteScore([
        { distanceM: 0, safetyScore: 29 },
        { distanceM: 0, safetyScore: 46 },
      ]),
    ).toBe(38);
  });
});

describe('toSafetyLevel', () => {
  it.each([
    [100, 'safe'],
    [70, 'safe'],
    [69, 'caution'],
    [40, 'caution'],
    [39, 'danger'],
    [0, 'danger'],
  ] as const)('%i점 → %s', (score, level) => {
    expect(toSafetyLevel(score)).toBe(level);
  });
});

describe('pickSafe', () => {
  const shortest = { name: '최단', distanceM: 1000, safetyScore: 50 };
  const route = (name: string, distanceM: number, safetyScore: number) => ({
    name,
    distanceM,
    safetyScore,
  });

  it('임시값: 5점 이상, 우회 20% 이하', () => {
    expect(SAFE_MIN_GAIN).toBe(5);
    expect(SAFE_MAX_DETOUR).toBe(0.2);
  });

  it('후보가 없으면 최단경로', () => {
    expect(pickSafe(shortest, [])).toBe(shortest);
  });

  it('5점 이상 높고 우회 20% 이하면 그 후보 (경계 포함)', () => {
    const c = route('넓은길', 1200, 55);
    expect(pickSafe(shortest, [c])).toBe(c);
  });

  it('4점만 높으면 최단경로', () => {
    expect(pickSafe(shortest, [route('넓은길', 1000, 54)])).toBe(shortest);
  });

  it('20%를 넘게 돌아가면 점수가 높아도 최단경로', () => {
    expect(pickSafe(shortest, [route('넓은길', 1201, 90)])).toBe(shortest);
  });

  it('조건에 맞는 후보가 여럿이면 점수가 높은 것, 같으면 짧은 것', () => {
    const a = route('a', 1100, 70);
    const b = route('b', 1050, 70);
    const c = route('c', 1150, 65);
    expect(pickSafe(shortest, [a, b, c])).toBe(b);
  });
});
