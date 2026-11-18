const JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY as string | undefined

// 카카오 JS SDK (로그인용, FR-011). 지도 SDK(lib/kakao.ts)와 다른 파일이다. 버전은 고정하고 integrity로 파일이 바뀌지 않았는지 브라우저가 확인한다
const SDK_URL = 'https://t1.kakaocdn.net/kakao_js_sdk/2.8.5/kakao.min.js'
// SDK_URL 파일의 SHA-384 (curl -s <주소> | openssl dgst -sha384 -binary | openssl base64 -A, 2026-11-13). 버전을 바꾸면 같이 바꾼다
const SDK_INTEGRITY = 'sha384-v6JKY3z4FUkWq21oZDHZe74YvuPk/WUrVLrDHTBojHXClOSa3iXy7sCXPY1jkFbj'

export type KakaoAuthorizeOptions = {
  redirectUri: string
  state: string
  throughTalk: boolean // false면 카카오톡 앱으로 넘어가지 않고 카카오 계정 웹 로그인 (홈 화면에 설치한 앱용)
}

// 쓰는 부분만 적은 카카오 JS SDK 타입 (전역 Kakao)
export type KakaoSdk = {
  init: (key: string) => void
  isInitialized: () => boolean
  Auth: { authorize: (options: KakaoAuthorizeOptions) => void }
}

declare global {
  interface Window {
    Kakao?: KakaoSdk
  }
}

let loading: Promise<KakaoSdk> | null = null

// SDK 파일이 이 시간 안에 오지 않으면 실패로 본다 (ms). 망이 멈춰 onload·onerror가 둘 다 오지 않으면 버튼이 반응 없이 기다리기만 해서
const LOAD_TIMEOUT_MS = 10_000

// 카카오 JS SDK를 한 번만 불러오고 JavaScript 키로 초기화한다 (REST 키 금지). 실패하면 다음 호출에서 다시 시도한다
export function loadKakaoSdk(): Promise<KakaoSdk> {
  if (loading) return loading
  loading = new Promise<KakaoSdk>((resolve, reject) => {
    if (!JS_KEY) {
      reject(new Error('VITE_KAKAO_JS_KEY가 설정되지 않았습니다. 루트 .env를 확인해 주세요.'))
      return
    }
    // onload 안에서 init이 던지면 Promise 밖의 예외라 이 Promise가 끝나지 않는다. 그래서 직접 잡아 실패로 돌린다
    const ready = () => {
      try {
        const sdk = window.Kakao
        if (!sdk) throw new Error('카카오 SDK를 불러오지 못했습니다.')
        if (!sdk.isInitialized()) sdk.init(JS_KEY)
        resolve(sdk)
      } catch (e) {
        reject(e instanceof Error ? e : new Error('카카오 SDK를 초기화하지 못했습니다.'))
      }
    }
    if (window.Kakao) {
      ready()
      return
    }
    const script = document.createElement('script')
    const fail = () => {
      clearTimeout(timer)
      script.remove() // 다음 시도에서 새 태그로 다시 불러오게
      reject(new Error('카카오 SDK를 불러오지 못했습니다.'))
    }
    const timer = setTimeout(fail, LOAD_TIMEOUT_MS)
    script.src = SDK_URL
    script.integrity = SDK_INTEGRITY
    script.crossOrigin = 'anonymous'
    script.onload = () => {
      clearTimeout(timer)
      ready()
    }
    script.onerror = fail
    document.head.appendChild(script)
  })
  loading.catch(() => {
    loading = null
  })
  return loading
}
