// 네이버·구글 로그인 주소와 앱 안 브라우저 판별 (FR-011). 카카오는 JS SDK(lib/kakaoSdk.ts)로 보내고, 네이버·구글은 SDK 없이 인가 주소로 보낸다.
// Client ID는 공개 값이라 웹에 둔다. Client Secret은 서버에만 있다 (API.md 5장)
const NAVER_CLIENT_ID = import.meta.env.VITE_NAVER_CLIENT_ID as string | undefined
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

export type RedirectProvider = 'naver' | 'google'

// 그 서비스의 인가(동의) 화면 주소. Client ID가 없으면 null — 화면은 로그인 실패 안내를 보여 준다
export function authorizeUrl(provider: RedirectProvider, state: string, redirectUri: string): string | null {
  if (provider === 'naver') {
    if (!NAVER_CLIENT_ID) return null
    const params = new URLSearchParams({ response_type: 'code', client_id: NAVER_CLIENT_ID, redirect_uri: redirectUri, state })
    return `https://nid.naver.com/oauth2.0/authorize?${params}`
  }
  if (!GOOGLE_CLIENT_ID) return null
  // 이메일은 받지 않는다 (openid profile). 계정이 여러 개면 고르게 해서, 탈퇴 확인 때 엉뚱한 계정으로 바로 넘어가지 않게 한다
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile',
    state,
    prompt: 'select_account',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

// 카카오톡 안의 브라우저인지. 구글은 앱 안 브라우저(웹뷰)에서 로그인을 막아(403 disallowed_useragent) 외부 브라우저로 넘긴다
export function isKakaoTalkInApp(ua: string = navigator.userAgent): boolean {
  return /KAKAOTALK/i.test(ua)
}

// 앱 안 브라우저인지 (카카오톡·인스타그램·페이스북·라인·네이버 앱·다음 앱, 안드로이드 웹뷰)
export function isInAppBrowser(ua: string = navigator.userAgent): boolean {
  return /KAKAOTALK|Instagram|FBAN|FBAV|Line\/|NAVER\(inapp|DaumApps|; wv\)/i.test(ua)
}

// 카카오톡 안에서 이 주소를 사파리·크롬 같은 외부 브라우저로 연다 (카카오톡 공식 스킴)
export function openInExternalBrowser(url: string) {
  location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`
}

// 구글 로그인이 막히는 앱 안 브라우저에서 보여 줄 안내. 카카오톡은 외부 브라우저로 넘기므로 안내하지 않는다
export const IN_APP_GOOGLE_NOTICE = '이 앱 안에서는 Google 로그인이 안 돼요. 사파리·크롬에서 열어 주세요.'

// 구글 버튼 아래에 안내를 붙일지
export function needsGoogleInAppNotice(ua: string = navigator.userAgent): boolean {
  return isInAppBrowser(ua) && !isKakaoTalkInApp(ua)
}
