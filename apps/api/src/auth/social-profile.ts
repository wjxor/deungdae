import { DEFAULT_NICKNAME } from '../kakao/kakao-auth.client.js';

/** 로그인 서비스(카카오·네이버·구글)에서 받은 회원 정보. 회원번호는 서비스마다 형식이 달라 문자열로 둔다 */
export type SocialProfile = { providerId: string; nickname: string };

/** 서비스가 준 닉네임·이름. 문자열이 아니거나 비면 "등대 회원" (카카오와 같은 기본값) */
export function nicknameOrDefault(value: unknown): string {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : DEFAULT_NICKNAME;
}
