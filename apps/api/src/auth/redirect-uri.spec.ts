import { isAllowedRedirectUri } from './redirect-uri.js';

const ORIGINS = ['http://localhost:5173', 'https://deungdae-map.vercel.app'];

describe('isAllowedRedirectUri', () => {
  it.each(['http://localhost:5173/', 'https://deungdae-map.vercel.app/'])(
    '허용 주소의 루트 %s는 통과',
    (uri) => {
      expect(isAllowedRedirectUri(uri, ORIGINS)).toBe(true);
    },
  );

  it.each([
    ['끝 / 없음', 'https://deungdae-map.vercel.app'],
    ['쿼리', 'https://deungdae-map.vercel.app/?x=1'],
    ['다른 경로', 'https://deungdae-map.vercel.app/auth'],
    ['조각(#)', 'https://deungdae-map.vercel.app/#a'],
    ['다른 주소', 'https://evil.example/'],
    [
      '허용 주소를 앞에 붙인 다른 주소',
      'https://deungdae-map.vercel.app.evil.example/',
    ],
    ['http로 바꾼 배포 주소', 'http://deungdae-map.vercel.app/'],
    ['주소가 아님', 'not a url'],
    ['빈 문자열', ''],
  ])('%s(%s)는 거절', (_, uri) => {
    expect(isAllowedRedirectUri(uri, ORIGINS)).toBe(false);
  });
});
