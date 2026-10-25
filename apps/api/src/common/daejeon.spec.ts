import { isDaejeonAddress, isInDaejeonRect } from './daejeon.js';

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

describe('isInDaejeonRect', () => {
  it.each([
    ['대전역', { lat: 36.3325, lng: 127.4342 }],
    ['충남대', { lat: 36.3664, lng: 127.3446 }],
  ])('%s는 안', (_, p) => {
    expect(isInDaejeonRect(p)).toBe(true);
  });

  it.each([
    ['서울역', { lat: 37.5547, lng: 126.9707 }],
    ['공주 시내', { lat: 36.4553, lng: 127.1247 }],
    ['위도·경도를 뒤집은 값', { lat: 127.4342, lng: 36.3325 }],
  ])('%s는 밖', (_, p) => {
    expect(isInDaejeonRect(p)).toBe(false);
  });
});
