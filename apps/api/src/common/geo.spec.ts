import { distanceM, parseLatLng, readLatLng } from './geo.js';

describe('distanceM', () => {
  it('대전시청 → 충남대 정문은 약 4km', () => {
    const d = distanceM(
      { lat: 36.3504, lng: 127.3845 },
      { lat: 36.3627, lng: 127.3449 },
    );
    expect(d).toBeGreaterThan(3700);
    expect(d).toBeLessThan(3900);
  });

  it('같은 점은 0', () => {
    expect(
      distanceM({ lat: 36.35, lng: 127.38 }, { lat: 36.35, lng: 127.38 }),
    ).toBe(0);
  });
});

describe('parseLatLng', () => {
  it('위도,경도 순으로 읽고 공백은 무시한다', () => {
    expect(parseLatLng(' 36.36 , 127.34 ')).toEqual({
      lat: 36.36,
      lng: 127.34,
    });
  });

  it.each([
    '',
    '36.36',
    '36.36,',
    ',127.34',
    'a,b',
    '36.36,127.34,0',
    '91,127',
    '36,181',
  ])('%j는 null', (raw) => {
    expect(parseLatLng(raw)).toBeNull();
  });
});

describe('readLatLng', () => {
  it('{ lat, lng } 숫자를 그대로 읽는다', () => {
    expect(readLatLng({ lat: 36.3325, lng: 127.4342, extra: 1 })).toEqual({
      lat: 36.3325,
      lng: 127.4342,
    });
  });

  it.each([
    undefined,
    null,
    '36.33,127.43',
    [36.33, 127.43],
    { lat: '36.33', lng: '127.43' },
    { lat: 36.33 },
    { lat: Number.NaN, lng: 127.43 },
    { lat: 91, lng: 127.43 },
    { lat: 36.33, lng: -181 },
  ])('%j는 null', (value) => {
    expect(readLatLng(value)).toBeNull();
  });
});
