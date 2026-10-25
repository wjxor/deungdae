import { distanceM, parseLatLng } from './geo.js';

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
