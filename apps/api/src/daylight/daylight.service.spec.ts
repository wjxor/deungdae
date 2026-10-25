import {
  SUNRISE_20261025,
  SUNSET_20261025,
} from '../../test/fixtures/kasi-rise-set.js';
import { externalApiError } from '../common/api-exception.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { DaylightService, isNight } from './daylight.service.js';
import type { KasiRiseSetClient } from './kasi-rise-set.client.js';

const SUN_TIMES = { sunrise: SUNRISE_20261025, sunset: SUNSET_20261025 };

/** 천문연 호출과 sun_times 쿼리만 가짜로 둔 서비스 */
function setup(configured = true) {
  const kasi = { riseSet: vi.fn(() => Promise.resolve(SUN_TIMES)) };
  const sunTime = {
    findUnique: vi.fn(() => Promise.resolve(null as unknown)),
    upsert: vi.fn(() => Promise.resolve({})),
  };
  const prisma = { configured, sunTime } as unknown as PrismaService;
  const service = new DaylightService(
    kasi as unknown as KasiRiseSetClient,
    prisma,
  );
  return { service, kasi, sunTime };
}

/** 지금을 한국 시간으로 정한다 */
const setNow = (kst: string) => vi.setSystemTime(new Date(`${kst}+09:00`));

beforeEach(() => {
  vi.useFakeTimers();
  setNow('2026-10-25T21:30:00');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isNight', () => {
  it.each([
    ['2026-10-25T00:10:00', true],
    ['2026-10-25T06:45:59', true],
    ['2026-10-25T06:46:00', false],
    ['2026-10-25T12:00:00', false],
    ['2026-10-25T17:42:00', false],
    ['2026-10-25T17:42:01', true],
    ['2026-10-25T23:59:00', true],
  ])('%s 한국 시간이면 %s', (kst, expected) => {
    expect(isNight(new Date(`${kst}+09:00`), SUN_TIMES)).toBe(expected);
  });
});

describe('DaylightService', () => {
  it('API.md 1-1장 형식으로 답한다 (한국 시간 ISO)', async () => {
    const { service } = setup();
    await expect(service.today()).resolves.toEqual({
      sunrise: '2026-10-25T06:46:00+09:00',
      sunset: '2026-10-25T17:42:00+09:00',
      isNight: true,
    });
  });

  it('DB에 없으면 천문연을 부르고 sun_times에 넣는다', async () => {
    const { service, kasi, sunTime } = setup();
    await service.today();

    expect(sunTime.findUnique).toHaveBeenCalledWith({
      where: {
        date_region: { date: new Date('2026-10-25T00:00:00Z'), region: '대전' },
      },
      select: { sunrise: true, sunset: true },
    });
    expect(kasi.riseSet).toHaveBeenCalledWith('2026-10-25', '대전');
    expect(sunTime.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          date: new Date('2026-10-25T00:00:00Z'),
          region: '대전',
          ...SUN_TIMES,
        },
      }),
    );
  });

  it('DB에 있으면 천문연을 부르지 않는다 (서버를 다시 켠 뒤)', async () => {
    const { service, kasi, sunTime } = setup();
    sunTime.findUnique.mockResolvedValue(SUN_TIMES);
    await expect(service.today()).resolves.toMatchObject({ isNight: true });
    expect(kasi.riseSet).not.toHaveBeenCalled();
    expect(sunTime.upsert).not.toHaveBeenCalled();
  });

  it('같은 날 두 번째부터는 DB·천문연 모두 부르지 않는다 (동시 요청 포함)', async () => {
    const { service, kasi, sunTime } = setup();
    await Promise.all([service.today(), service.today(), service.today()]);
    setNow('2026-10-25T23:59:00');
    await service.today();
    expect(sunTime.findUnique).toHaveBeenCalledTimes(1);
    expect(kasi.riseSet).toHaveBeenCalledTimes(1);
  });

  it('isNight는 같은 날 값을 써도 요청 때의 시각으로 다시 판별한다', async () => {
    const { service } = setup();
    setNow('2026-10-25T12:00:00');
    await expect(service.today()).resolves.toMatchObject({ isNight: false });
    setNow('2026-10-25T18:00:00');
    await expect(service.today()).resolves.toMatchObject({ isNight: true });
  });

  it('한국 자정이 지나면 다음 날 값을 새로 받는다', async () => {
    const { service, kasi } = setup();
    await service.today();
    setNow('2026-10-26T00:00:30');
    kasi.riseSet.mockResolvedValue({
      sunrise: new Date('2026-10-26T06:47:00+09:00'),
      sunset: new Date('2026-10-26T17:41:00+09:00'),
    });
    await expect(service.today()).resolves.toEqual({
      sunrise: '2026-10-26T06:47:00+09:00',
      sunset: '2026-10-26T17:41:00+09:00',
      isNight: true,
    });
    expect(kasi.riseSet).toHaveBeenLastCalledWith('2026-10-26', '대전');
  });

  it('천문연이 실패하면 502를 그대로 던지고, 다음 요청은 다시 부른다', async () => {
    const { service, kasi } = setup();
    kasi.riseSet.mockRejectedValueOnce(externalApiError('실패'));
    await expect(service.today()).rejects.toMatchObject({ status: 502 });
    await expect(service.today()).resolves.toMatchObject({ isNight: true });
    expect(kasi.riseSet).toHaveBeenCalledTimes(2);
  });

  it('DATABASE_URL이 없으면 DB 없이 천문연 값만 쓴다', async () => {
    const { service, kasi, sunTime } = setup(false);
    await expect(service.today()).resolves.toMatchObject({ isNight: true });
    expect(kasi.riseSet).toHaveBeenCalledTimes(1);
    expect(sunTime.findUnique).not.toHaveBeenCalled();
    expect(sunTime.upsert).not.toHaveBeenCalled();
  });

  it('DB 읽기·저장이 실패해도 천문연 값으로 답한다', async () => {
    const { service, kasi, sunTime } = setup();
    sunTime.findUnique.mockRejectedValue(new Error('connection refused'));
    sunTime.upsert.mockRejectedValue(new Error('connection refused'));
    await expect(service.today()).resolves.toMatchObject({ isNight: true });
    expect(kasi.riseSet).toHaveBeenCalledTimes(1);
  });
});
