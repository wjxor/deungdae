import { toKstDate, toKstIso } from './time.js';

describe('toKstIso', () => {
  it('UTC 시각을 한국 시간(+09:00)으로 바꾼다', () => {
    expect(toKstIso(new Date('2026-09-16T12:30:00Z'))).toBe(
      '2026-09-16T21:30:00+09:00',
    );
  });

  it('한국 시간으로 자정을 넘으면 날짜도 바뀐다', () => {
    expect(toKstIso(new Date('2026-10-21T15:30:05.678Z'))).toBe(
      '2026-10-22T00:30:05+09:00',
    );
  });
});

describe('toKstDate', () => {
  it('한국 시간 날짜를 돌려준다', () => {
    expect(toKstDate(new Date('2026-10-25T03:00:00Z'))).toBe('2026-10-25');
  });

  it('UTC로는 전날이어도 한국 자정이 지났으면 다음 날', () => {
    expect(toKstDate(new Date('2026-10-25T14:59:59Z'))).toBe('2026-10-25');
    expect(toKstDate(new Date('2026-10-25T15:00:00Z'))).toBe('2026-10-26');
  });
});
