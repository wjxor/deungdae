/**
 * 웹이 넘긴 redirectUri가 허용된 웹 주소의 루트(`<origin>/`)인지 본다.
 * 카카오 콘솔에 등록한 리다이렉트 URI도 루트 두 개라, 문자열이 정확히 같을 때만 통과시킨다.
 * Vercel 웹은 없는 경로를 열면 404라 루트로만 받는다 (`/auth/kakao` 같은 경로는 설정이 더 필요)
 */
export function isAllowedRedirectUri(uri: string, origins: string[]): boolean {
  return origins.some((origin) => uri === `${origin}/`);
}
