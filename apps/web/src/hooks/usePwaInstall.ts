import { useEffect, useState } from 'react'

// 안드로이드 크롬이 주는 설치 이벤트. 표준 타입에 없어 필요한 부분만 적는다
type InstallPromptEvent = Event & { prompt: () => Promise<void> }

export type PwaInstall =
  | { kind: 'none' } // 이미 설치해서 열었거나, 설치 안내를 줄 수 없는 브라우저
  | { kind: 'prompt'; install: () => void } // 안드로이드 크롬: 우리 설치 버튼
  | { kind: 'ios' } // 아이폰 사파리: 설치 버튼 API가 없어 안내 문구만

const DISMISS_KEY = 'deungdae.installHintDismissed'

// 홈 화면에 설치한 앱으로 열었는지. 카카오 로그인도 이 값으로 카카오톡 앱을 거칠지 정한다 (lib/auth.ts)
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function isIosSafari() {
  const ua = navigator.userAgent
  const ios = /iPhone|iPad|iPod/.test(ua)
  // 아이폰의 크롬·네이버앱 등은 홈 화면 추가가 안 되거나 메뉴가 달라서 사파리만 안내한다
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|NAVER|KAKAOTALK|Instagram/.test(ua)
}

function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function usePwaInstall() {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(readDismissed)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault() // 크롬 기본 안내 대신 우리 버튼으로 연다
      setEvent(e as InstallPromptEvent)
    }
    const onInstalled = () => setEvent(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // 저장이 막혀 있으면 이번 접속에서만 숨긴다
    }
  }

  let state: PwaInstall = { kind: 'none' }
  if (!dismissed && !isStandalone()) {
    if (event) {
      state = {
        kind: 'prompt',
        install: () => {
          void event.prompt().finally(() => setEvent(null))
        },
      }
    } else if (isIosSafari()) {
      state = { kind: 'ios' }
    }
  }
  return { state, dismiss }
}
