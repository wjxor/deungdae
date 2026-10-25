/**
 * 로그에 남길 DB 에러 문장. Prisma 에러 본문에는 쿼리 값(경로 좌표, 지도 범위)이 들어갈 수 있어
 * 에러 이름·코드·첫 줄만 남긴다
 */
export function dbErrorText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const code = (e as { code?: unknown }).code;
  const firstLine = e.message.split('\n').find((line) => line.trim() !== '');
  return [e.name, typeof code === 'string' ? code : '', firstLine ?? '']
    .filter(Boolean)
    .join(' ');
}
