import { useState } from 'react'
import type { SocialProvider, User } from '../../../../shared/types'

export type { SocialProvider }

// ready가 false면 버튼을 눌러지지 않게 두고 "준비 중"만 보여 준다 (카카오를 먼저 붙인다)
export const PROVIDERS: { value: SocialProvider; label: string; ready: boolean }[] = [
  { value: 'kakao', label: '카카오로 시작하기', ready: true },
  { value: 'naver', label: '네이버로 시작하기', ready: false },
  { value: 'google', label: 'Google로 시작하기', ready: false },
]

// 소셜 로그인 처리는 서버(상협) 담당이다. 서버가 카카오 동의 화면으로 보내고 우리 토큰을 돌려주는 흐름이라 이 함수 안만 바꾼다.
// 카카오를 먼저 붙이고 네이버·구글은 뒤에 붙인다 (PROVIDERS의 ready).
// 화면은 이 함수와 useAuth가 돌려주는 user만 안다.
// 지금은 서버가 없어서 개발 서버(npm run dev)에서만 가짜 회원으로 로그인되고, 배포본에서는 실패(null)로 돌아간다.
async function requestSocialLogin(provider: SocialProvider): Promise<User | null> {
  if (import.meta.env.DEV && provider === 'kakao') {
    return { id: 0, email: null, nickname: '테스트 회원', provider }
  }
  return null
}

// 회원 탈퇴도 서버(상협) 담당이다. 성공하면 true. 서버가 없는 지금은 개발 서버에서만 성공한다
async function requestDeleteAccount(): Promise<boolean> {
  return import.meta.env.DEV
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)

  // 성공하면 true. 서버 연결 전에는 false라 화면이 "준비 중" 안내를 보여 준다
  const login = async (provider: SocialProvider) => {
    const u = await requestSocialLogin(provider)
    if (u) setUser(u)
    return u !== null
  }
  const logout = () => setUser(null)
  const deleteAccount = async () => {
    const ok = await requestDeleteAccount()
    if (ok) setUser(null)
    return ok
  }

  return { user, login, logout, deleteAccount }
}
