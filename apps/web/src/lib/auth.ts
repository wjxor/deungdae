import { useCallback, useEffect, useState } from 'react'
import type { SocialProvider, User } from '../../../../shared/types'
import { isStandalone } from '../hooks/usePwaInstall'
import { deleteMe, fetchMe, loginWithKakao, loginWithSocial } from './api'
import { ApiRequestError } from './apiError'
import { loadKakaoSdk } from './kakaoSdk'
import { authorizeUrl, isKakaoTalkInApp, openInExternalBrowser, type RedirectProvider } from './socialLogin'

export type { SocialProvider }

// ready가 false면 버튼을 눌러지지 않게 두고 "준비 중"만 보여 준다. 셋 다 붙었다 (네이버·구글 2026-11-17)
export const PROVIDERS: { value: SocialProvider; label: string; ready: boolean }[] = [
  { value: 'kakao', label: '카카오로 시작하기', ready: true },
  { value: 'naver', label: '네이버로 시작하기', ready: true },
  { value: 'google', label: 'Google로 시작하기', ready: true },
]

export const PROVIDER_NAME: Record<SocialProvider, string> = { kakao: '카카오', naver: '네이버', google: 'Google' }

// 로그인 실패 안내. 어느 서비스였는지 모르면(보낸 기록이 없음) 서비스 이름을 빼고 쓴다
export function loginFailedMessage(provider: SocialProvider | null): string {
  return `${provider ? `${PROVIDER_NAME[provider]} ` : ''}로그인을 하지 못했어요. 다시 시도해 주세요.`
}

// 탈퇴 결과. 네이버·구글은 서비스 확인 화면으로 넘어가서(redirecting) 결과는 돌아온 뒤 accountNotice로 알린다.
// expired는 로그인이 만료됐거나 다른 기기에서 이미 탈퇴해 로그아웃시킨 것이다 (안내는 accountNotice)
export type DeleteResult = 'deleted' | 'redirecting' | 'expired' | 'failed'

export const ACCOUNT_DELETED_MESSAGE = '탈퇴했어요. 그동안 등대를 써 주셔서 고마워요.'
export const DELETE_FAILED_MESSAGE = '탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요.'
export const DELETE_CANCELLED_MESSAGE = '탈퇴를 취소했어요.'
// 만료된 토큰으로는 몇 번을 다시 눌러도 서버가 401로 거절한다. 그래서 로그아웃시키고 다시 로그인하라고 안내한다
export const DELETE_EXPIRED_MESSAGE = '로그인이 만료됐어요. 다시 로그인한 뒤 탈퇴해 주세요.'
// 로그인 서비스에서 돌아와 서버 응답을 기다리는 동안(1~3초) 지도 홈에 띄운다
const LOGIN_BUSY_MESSAGE = '로그인하는 중이에요…'
const DELETE_BUSY_MESSAGE = '탈퇴하는 중이에요…'

// 로그인 정보는 이 브라우저에만 둔다. 서버는 토큰을 저장하지 않아 로그아웃은 이 값을 지우는 것이다 (API.md 5장)
const SESSION_KEY = 'deungdae.auth'
// 로그인 서비스로 보낼 때 남기는 기록. 돌아온 요청이 우리가 보낸 것인지(state, CSRF 방지) 확인하고,
// 셋 다 같은 루트로 돌아와서 어느 서비스·무슨 일(로그인/탈퇴 확인)이었는지도 여기서 꺼낸다
const PENDING_KEY = 'deungdae.oauthPending'

type Purpose = 'login' | 'delete'
type Pending = { state: string; provider: SocialProvider; purpose: Purpose }

type Session = { accessToken: string; user: User }

// 로그인 흐름 (FR-011, API.md 5장)
// 1. [카카오로 시작하기]는 카카오 JS SDK가, [네이버로 시작하기]·[Google로 시작하기]는 인가 주소로 바로 동의 화면에 보낸다 (Client Secret·REST 키는 서버에만)
// 2. 서비스가 이 주소의 루트로 ?code=…&state=…를 붙여 돌려보낸다
// 3. 서버에 code를 넘기면 서버가 서비스 토큰으로 바꾸고 회원을 찾거나 만들어 우리 로그인 토큰을 준다

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

// 서비스 콘솔에 등록한 리다이렉트 URI(배포 주소·localhost:5173의 루트)와 같아야 한다. 서버도 이 값만 받는다
function redirectUri() {
  return `${location.origin}/`
}

function savePending(pending: Pending) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
  } catch {
    // 저장을 못 하면 돌아왔을 때 확인이 실패해 다시 하게 된다
  }
}

// 보낸 기록을 읽는다. 없거나 모양이 틀리면 null
function readPending(): Pending | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    const value = raw ? (JSON.parse(raw) as Partial<Pending> | null) : null
    const knownProvider = value?.provider === 'kakao' || value?.provider === 'naver' || value?.provider === 'google'
    const knownPurpose = value?.purpose === 'login' || value?.purpose === 'delete'
    return typeof value?.state === 'string' && knownProvider && knownPurpose ? (value as Pending) : null
  } catch {
    return null
  }
}

function clearPending() {
  try {
    sessionStorage.removeItem(PENDING_KEY)
  } catch {
    // 지울 수 없으면 원래 저장도 안 된 것이다
  }
}

// 보낸 기록을 꺼내고 지운다 (한 번만 쓴다)
function takePending(): Pending | null {
  const pending = readPending()
  clearPending()
  return pending
}

// 카카오 동의 화면으로 보낸다. 페이지가 카카오로 넘어가면 true, SDK를 못 불러오거나 초기화·이동이 실패하면 false.
// 던지지 않고 false로 돌려야 로그인 화면이 실패 안내를 보여 준다 (던지면 버튼이 반응 없이 끝난다)
async function startKakaoLogin(): Promise<boolean> {
  try {
    const sdk = await loadKakaoSdk()
    const state = crypto.randomUUID()
    savePending({ state, provider: 'kakao', purpose: 'login' })
    // 아이폰은 홈 화면에 설치한 앱과 사파리가 저장소를 따로 써서, 카카오톡 앱을 거치면 사파리로 돌아와 앱에는 로그인이 안 된다
    sdk.Auth.authorize({ redirectUri: redirectUri(), state, throughTalk: !isStandalone() })
    return true
  } catch {
    clearPending()
    return false
  }
}

// 네이버·구글 동의 화면으로 보낸다. 넘어가면 true, Client ID가 없으면 false.
// 구글은 카카오톡 안 브라우저에서 로그인이 막혀서, 그때는 등대를 외부 브라우저로 다시 연다.
// 화면을 바꿔도 주소는 그대로라 외부 브라우저에는 지도 홈이 열리고, 거기서 [로그인] → [Google로 시작하기]를 다시 누른다
function startRedirect(provider: RedirectProvider, purpose: Purpose): boolean {
  if (provider === 'google' && isKakaoTalkInApp()) {
    openInExternalBrowser(location.href)
    return true
  }
  const state = crypto.randomUUID()
  const url = authorizeUrl(provider, state, redirectUri())
  if (!url) return false
  savePending({ state, provider, purpose })
  location.assign(url)
  return true
}

type RedirectResult =
  | { kind: 'none' } // 로그인 서비스에서 돌아온 게 아님
  | { kind: 'cancelled' } // 사용자가 서비스 화면에서 취소함
  | { kind: 'failed'; provider: SocialProvider | null }
  | { kind: 'ok'; session: Session }
  | { kind: 'deleted' } // 탈퇴 확인을 거쳐 탈퇴를 마침
  | { kind: 'deleteFailed'; message: string } // 탈퇴하지 않음 (취소·실패). message를 지도 홈에 띄운다

// 서비스가 돌아올 때 주소에 붙이는 값. 구글은 scope·authuser·prompt·hd와 보낸 곳을 알리는 iss(RFC 9207)도 붙인다
const RETURN_KEYS = ['code', 'state', 'error', 'error_description', 'scope', 'authuser', 'prompt', 'hd', 'iss']

let redirectResult: Promise<RedirectResult> | null = null

// 로그인 서비스에서 인가 코드를 들고 돌아와 서버에 보낼 참이면 기다리는 동안 보여 줄 안내, 아니면 null.
// 첫 화면을 그릴 때 부른다 (주소에서 code를 지우는 completeRedirect보다 먼저)
function initialBusyNotice(): string | null {
  const params = new URLSearchParams(location.search)
  if (!params.get('code') || params.get('error')) return null
  return readPending()?.purpose === 'delete' ? DELETE_BUSY_MESSAGE : LOGIN_BUSY_MESSAGE
}

// 로그인 서비스에서 돌아왔으면 로그인을 끝낸다. 인가 코드는 한 번만 쓸 수 있어서, 몇 번 불러도(개발 모드 StrictMode의 effect 두 번 등) 서버에는 한 번만 보낸다
function completeRedirect(): Promise<RedirectResult> {
  redirectResult ??= handleRedirect()
  return redirectResult
}

async function handleRedirect(): Promise<RedirectResult> {
  const params = new URLSearchParams(location.search)
  const code = params.get('code')
  const state = params.get('state')
  const error = params.get('error')
  if (!code && !error) return { kind: 'none' }

  // 새로고침하거나 주소를 공유해도 code가 남지 않게 주소에서 먼저 지운다
  for (const key of RETURN_KEYS) params.delete(key)
  const rest = params.toString()
  history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`)

  const pending = takePending()
  // 사용자가 서비스 화면에서 취소하면 셋 다 access_denied다. 로그인 취소는 안내 없이 넘어가고, 탈퇴 확인을 취소하면 탈퇴하지 않았다고 알린다.
  // 그 밖의 error(카카오톡 로그인 시간 초과 timeout 등)는 사용자가 고른 게 아니라서 실패로 알린다
  if (error) {
    if (pending?.purpose === 'delete') {
      return { kind: 'deleteFailed', message: error === 'access_denied' ? DELETE_CANCELLED_MESSAGE : DELETE_FAILED_MESSAGE }
    }
    return error === 'access_denied' ? { kind: 'cancelled' } : { kind: 'failed', provider: pending?.provider ?? null }
  }
  const checked = code && state && pending && state === pending.state ? { code, state, pending } : null
  if (pending?.purpose === 'delete') {
    return checked ? completeDelete(checked.pending.provider, checked.code, checked.state) : { kind: 'deleteFailed', message: DELETE_FAILED_MESSAGE }
  }
  if (!code || !state || !pending || state !== pending.state) return { kind: 'failed', provider: pending?.provider ?? null }

  try {
    const req = { code, redirectUri: redirectUri() }
    const res = pending.provider === 'kakao' ? await loginWithKakao(req) : await loginWithSocial(pending.provider, { ...req, state })
    const session = { accessToken: res.accessToken, user: res.user }
    saveSession(session)
    return { kind: 'ok', session }
  } catch {
    return { kind: 'failed', provider: pending.provider }
  }
}

// 네이버·구글 탈퇴 확인에서 돌아왔을 때. 저장해 둔 로그인 토큰과 새로 받은 코드로 서버에 탈퇴를 요청한다.
// 서버가 다른 계정이라고 거절하면(400) 그 문구를 그대로 보여 준다
async function completeDelete(provider: SocialProvider, code: string, state: string): Promise<RedirectResult> {
  const saved = readSession()
  if (!saved || provider === 'kakao' || saved.user.provider !== provider) return { kind: 'deleteFailed', message: DELETE_FAILED_MESSAGE }
  try {
    await deleteMe(saved.accessToken, { code, redirectUri: redirectUri(), state })
  } catch (e) {
    const message = e instanceof ApiRequestError && e.code === 'INVALID_INPUT' ? e.message : DELETE_FAILED_MESSAGE
    return { kind: 'deleteFailed', message }
  }
  clearSession()
  return { kind: 'deleted' }
}

export function useAuth() {
  // 저장해 둔 로그인을 먼저 보여 준다. 서버 확인을 기다리는 동안 비회원 메뉴가 잠깐 보였다가 바뀌지 않게
  const [session, setSession] = useState<Session | null>(readSession)
  const [loginError, setLoginError] = useState<string | null>(null)
  // 탈퇴 확인에서 돌아온 결과 안내 (지도 홈에 띄운다). 지우는 함수는 App의 타이머가 렌더마다 다시 걸리지 않게 고정한다
  const [accountNotice, setAccountNotice] = useState<string | null>(null)
  const clearAccountNotice = useCallback(() => setAccountNotice(null), [])
  // 로그인 서비스에서 돌아와 서버 응답을 기다리는 동안의 안내 ("로그인하는 중이에요…"). 그동안 비회원 메뉴만 보이고 아무 표시가 없어서
  const [busyNotice, setBusyNotice] = useState<string | null>(initialBusyNotice)

  useEffect(() => {
    let active = true
    completeRedirect().then((result) => {
      if (!active) return
      setBusyNotice(null)
      if (result.kind === 'ok') {
        setSession(result.session)
        return
      }
      if (result.kind === 'deleted') {
        setSession(null)
        setAccountNotice(ACCOUNT_DELETED_MESSAGE)
        return
      }
      if (result.kind === 'deleteFailed') setAccountNotice(result.message)
      if (result.kind === 'failed') setLoginError(loginFailedMessage(result.provider))

      // 돌아온 게 아니면 저장해 둔 토큰이 아직 쓸 수 있는지 서버에 확인한다
      const saved = readSession()
      if (!saved) return
      // 응답을 기다리는 사이 로그아웃·탈퇴했거나 다른 로그인으로 바뀌었으면 늦게 온 응답을 버린다.
      // 버리지 않으면 공용 기기에서 로그아웃한 앞 사람의 로그인이 되살아난다
      const stillSaved = () => readSession()?.accessToken === saved.accessToken
      fetchMe(saved.accessToken).then(
        ({ user }) => {
          if (!active || !stillSaved()) return
          const next = { ...saved, user } // 서비스 닉네임이 바뀌었으면 최신 값으로
          saveSession(next)
          setSession(next)
        },
        (e: unknown) => {
          if (!active || !stillSaved()) return
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

  // 서비스로 가면 페이지를 떠나서 true가 돌아와도 화면은 그대로다. false면 화면이 실패 안내를 보여 준다
  const login = (provider: SocialProvider) => (provider === 'kakao' ? startKakaoLogin() : Promise.resolve(startRedirect(provider, 'login')))

  const logout = () => {
    clearSession()
    setSession(null)
  }

  // 카카오 회원은 서버가 바로 연결을 끊고 회원을 지운 뒤 이 브라우저의 로그인도 지운다 ('deleted').
  // 네이버·구글 회원은 서버가 연결을 끊으려면 그 서비스 토큰이 필요해서, 서비스 로그인을 한 번 더 거친다 ('redirecting' — 결과는 돌아와서).
  // 그 전에 로그인이 살아 있는지 먼저 본다. 만료된 채로 다녀오면 서버가 401로 거절해 확인을 헛걸음하게 된다.
  // 만료·이미 탈퇴(401)면 로그아웃시키고 다시 로그인하라고 안내한다 ('expired'). 그대로 두면 몇 번을 눌러도 같은 실패만 되풀이된다
  const deleteAccount = async (): Promise<DeleteResult> => {
    if (!session) return 'failed'
    const { provider } = session.user
    try {
      if (provider === 'kakao') await deleteMe(session.accessToken)
      else await fetchMe(session.accessToken)
    } catch (e) {
      if (!(e instanceof ApiRequestError && e.code === 'UNAUTHORIZED')) return 'failed'
      clearSession()
      setSession(null)
      setAccountNotice(DELETE_EXPIRED_MESSAGE)
      return 'expired'
    }
    if (provider !== 'kakao') return startRedirect(provider, 'delete') ? 'redirecting' : 'failed'
    clearSession()
    setSession(null)
    return 'deleted'
  }

  return {
    user: session?.user ?? null,
    login,
    logout,
    deleteAccount,
    loginError,
    clearLoginError: () => setLoginError(null),
    accountNotice,
    clearAccountNotice,
    busyNotice,
  }
}
