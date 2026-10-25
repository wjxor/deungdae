import { isDaejeonAddress } from './daejeon.js';

describe('isDaejeonAddress', () => {
  it.each(['대전 유성구 궁동 220', '대전광역시 동구 동대전로 171', '대전'])(
    '%j는 대전',
    (address) => {
      expect(isDaejeonAddress(address)).toBe(true);
    },
  );

  it.each([
    '세종특별자치시 보람동 626-5',
    '충남 계룡시 엄사면',
    '충북 옥천군 군북면',
    '대전시청 앞',
    '',
  ])('%j는 대전 아님', (address) => {
    expect(isDaejeonAddress(address)).toBe(false);
  });
});
