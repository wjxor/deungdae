import { useState } from 'react'
import type { User } from '../../../../shared/types'

export type SocialProvider = 'kakao' | 'naver' | 'google'

export const PROVIDERS: { value: SocialProvider; label: string }[] = [
  { value: 'kakao', label: '카카오로 시작하기' },
  { value: 'naver', label: '네이버로 시작하기' },
  { value: 'google', label: 'Google로 시작하기' },
]

// 소셜 로그인 처리는 서버(상협) 담당이다. 방식이 정해지면(API.md 5장) 이 함수 안만 바꾼다.
// 화면은 이 함수와 useAuth가 돌려주는 user만 안다.
// 지금은 서버가 없어서 개발 서버(npm run dev)에서만 가짜 회원으로 로그인되고, 배포본에서는 실패(null)로 돌아간다.
async function requestSocialLogin(provider: SocialProvider): Promise<User | null> {
  if (import.meta.env.DEV) {
    return { id: 0, email: `${provider}@example.com`, nickname: '테스트 회원' }
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
