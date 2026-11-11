import { allowedOrigins } from './app.setup.js';

describe('allowedOrigins', () => {
  it('CORS_ORIGINS가 없으면 개발 서버만', () => {
    expect(allowedOrigins(undefined)).toEqual(['http://localhost:5173']);
    expect(allowedOrigins('')).toEqual(['http://localhost:5173']);
  });

  it('쉼표로 여러 주소를 받고 공백·끝 /를 뗀다', () => {
    expect(
      allowedOrigins(
        ' https://deungdae-map.vercel.app/ , https://example.com,, ',
      ),
    ).toEqual([
      'http://localhost:5173',
      'https://deungdae-map.vercel.app',
      'https://example.com',
    ]);
  });

  it('개발 서버 주소를 또 적어도 한 번만', () => {
    expect(allowedOrigins('http://localhost:5173')).toEqual([
      'http://localhost:5173',
    ]);
  });
});
