import { dbErrorText } from './db-error.js';

describe('dbErrorText', () => {
  it('에러 이름·코드·첫 줄만 남기고 나머지 줄(쿼리 값이 들어갈 수 있음)은 버린다', () => {
    const e = Object.assign(
      new Error(
        '\nInvalid `prisma.$queryRaw()` invocation:\n\n36.3325,127.4342',
      ),
      { name: 'PrismaClientKnownRequestError', code: 'P2010' },
    );
    expect(dbErrorText(e)).toBe(
      'PrismaClientKnownRequestError P2010 Invalid `prisma.$queryRaw()` invocation:',
    );
  });

  it('코드가 없으면 이름과 첫 줄만', () => {
    expect(dbErrorText(new Error('connection refused'))).toBe(
      'Error connection refused',
    );
  });

  it('Error가 아니면 문자열로', () => {
    expect(dbErrorText('timeout')).toBe('timeout');
  });
});
