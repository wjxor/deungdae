import { useEffect, useState } from 'react'
import type { SocialProvider, User } from '../../../../shared/types'
import { isStandalone } from '../hooks/usePwaInstall'
import { deleteMe, fetchMe, loginWithKakao } from './api'
import { ApiRequestError } from './apiError'
import { loadKakaoSdk } from './kakaoSdk'

export type { SocialProvider }

// ready가 false면 버튼을 눌러지지 않게 두고 "준비 중"만 보여 준다 (카카오를 먼저 붙인다)
export const PROVIDERS: { value: SocialProvider; label: string; ready: boolean }[] = [
  { value: 'kakao', label: '카카오로 시작하기', ready: true },
  { value: 'naver', label: '네이버로 시작하기', ready: false },
  { value: 'google', label: 'Google로 시작하기', ready: false },
]

export const LOGIN_FAILED_MESSAGE = '카카오 로그인을 하지 못했어요. 다시 시도해 주세요.'

// 로그인 정보는 이 브라우저에만 둔다. 서버는 토큰을 저장하지 않아 로그아웃은 이 값을 지우는 것이다 (API.md 5장)
const SESSION_KEY = 'deungdae.auth'
// 카카오에 갔다 돌아온 요청이 우리가 보낸 것인지 확인하는 값 (CSRF 방지, 카카오 문서 state)
const STATE_KEY = 'deungdae.kakaoState'

type Session = { accessToken: string; user: User }

// 카카오 로그인 흐름 (FR-011, 노션 "서버 카카오 로그인 설계" ③)
// 1. [카카오로 시작하기] → 카카오 JS SDK가 동의 화면으로 보낸다 (JS 키만 씀, REST 키는 서버에만)
// 2. 카카오가 이 주소의 루트로 ?code=…&state=…를 붙여 돌려보낸다
// 3. 서버에 code를 넘기면 서버가 카카오 토큰으로 바꾸고 회원을 찾거나 만들어 우리 로그인 토큰을 준다

// localStorage를 못 쓰는 브라우저(개인정보 보호 모드 등)에서도 앱이 멈추지 않게 읽기·쓰기를 모두 감싼다. 그때 로그인은 지금 탭에서만 유지된다
function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<Session> | null
    return typeof value?.accessToken === 'string' && value.user ? (value as Session) : null
  } catch {
    return null
  }
}

function saveSession(session: Session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // 저장을 못 해도 지금 화면의 로그인은 그대로 쓴다
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // 지울 수 없으면 원래 저장도 안 된 것이다
  }
}

// 카카오 콘솔에 등록한 리다이렉트 URI(배포 주소·localhost:5173의 루트)와 같아야 한다. 서버도 이 값만 받는다
function redirectUri() {
  return `${location.origin}/`
}

// 카카오 동의 화면으로 보낸다. 페이지가 카카오로 넘어가면 true, SDK를 못 불러오면 false
async function startKakaoLogin(): Promise<boolean> {
  let sdk
  try {
    sdk = await loadKakaoSdk()
  } catch {
    return false
  }
  const state = crypto.randomUUID()
  try {
    sessionStorage.setItem(STATE_KEY, state)
  } catch {
    // 저장을 못 하면 돌아왔을 때 확인이 실패해 다시 로그인하게 된다
  }
  // 아이폰은 홈 화면에 설치한 앱과 사파리가 저장소를 따로 써서, 카카오톡 앱을 거치면 사파리로 돌아와 앱에는 로그인이 안 된다
  sdk.Auth.authorize({ redirectUri: redirectUri(), state, throughTalk: !isStandalone() })
  return true
}

type RedirectResult =
  | { kind: 'none' } // 카카오에서 돌아온 게 아님
  | { kind: 'cancelled' } // 사용자가 카카오 화면에서 취소함
  | { kind: 'failed' }
  | { kind: 'ok'; session: Session }

let redirectResult: Promise<RedirectResult> | null = null

// 카카오에서 돌아왔으면 로그인을 끝낸다. 인가 코드는 한 번만 쓸 수 있어서, 몇 번 불러도(개발 모드 StrictMode의 effect 두 번 등) 서버에는 한 번만 보낸다
function completeKakaoRedirect(): Promise<RedirectResult> {
  redirectResult ??= handleKakaoRedirect()
  return redirectResult
}

async function handleKakaoRedirect(): Promise<RedirectResult> {
  const params = new URLSearchParams(location.search)
  const code = params.get('code')
  const state = params.get('state')
  const error = params.get('error')
  if (!code && !error) return { kind: 'none' }

  // 새로고침하거나 주소를 공유해도 code가 남지 않게 주소에서 먼저 지운다
  for (const key of ['code', 'state', 'error', 'error_description']) params.delete(key)
  const rest = params.toString()
  history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`)

  let saved: string | null = null
  try {
    saved = sessionStorage.getItem(STATE_KEY)
    sessionStorage.removeItem(STATE_KEY)
  } catch {
    // 못 읽으면 아래에서 실패로 본다
  }
  if (error) return { kind: 'cancelled' }
  if (!code || !state || state !== saved) return { kind: 'failed' }

  try {
    const res = await loginWithKakao({ code, redirectUri: redirectUri() })
    const session = { accessToken: res.accessToken, user: res.user }
    saveSession(session)
    return { kind: 'ok', session }
  } catch {
    return { kind: 'failed' }
  }
}

export function useAuth() {
  // 저장해 둔 로그인을 먼저 보여 준다. 서버 확인을 기다리는 동안 비회원 메뉴가 잠깐 보였다가 바뀌지 않게
  const [session, setSession] = useState<Session | null>(readSession)
  const [loginError, setLoginError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    completeKakaoRedirect().then((result) => {
      if (!active) return
      if (result.kind === 'ok') {
        setSession(result.session)
        return
      }
      if (result.kind === 'failed') setLoginError(LOGIN_FAILED_MESSAGE)

      // 돌아온 게 아니면 저장해 둔 토큰이 아직 쓸 수 있는지 서버에 확인한다
      const saved = readSession()
      if (!saved) return
      fetchMe(saved.accessToken).then(
        ({ user }) => {
          if (!active) return
          const next = { ...saved, user } // 카카오 닉네임이 바뀌었으면 최신 값으로
          saveSession(next)
          setSession(next)
        },
        (e: unknown) => {
          if (!active) return
          // 만료·탈퇴면 비회원으로. 연결 실패(오프라인 등)면 저장값을 그대로 둔다
          if (e instanceof ApiRequestError && e.code === 'UNAUTHORIZED') {
            clearSession()
            setSession(null)
          }
        },
      )
    })
    return () => {
      active = false
    }
  }, [])

  // 카카오로 가면 페이지를 떠나서 true가 돌아와도 화면은 그대로다. false면 화면이 실패 안내를 보여 준다
  const login = (provider: SocialProvider) => (provider === 'kakao' ? startKakaoLogin() : Promise.resolve(false))

  const logout = () => {
    clearSession()
    setSession(null)
  }

  // 성공하면 true. 카카오 연결을 끊고 서버에서 회원을 지운 뒤 이 브라우저의 로그인도 지운다
  const deleteAccount = async () => {
    if (!session) return false
    try {
      await deleteMe(session.accessToken)
    } catch {
      return false
    }
    clearSession()
    setSession(null)
    return true
  }

  return {
    user: session?.user ?? null,
    login,
    logout,
    deleteAccount,
    loginError,
    clearLoginError: () => setLoginError(null),
  }
}
