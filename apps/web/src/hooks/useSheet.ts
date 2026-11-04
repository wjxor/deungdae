import { useEffect, useRef } from 'react'

// 바닥 시트(내 정보·즐겨찾기)가 지켜야 할 것: ESC로 닫히고, 열면 포커스가 시트로 가고, 폰 뒤로가기가 앞 화면이 아니라 시트를 닫는다.
// 시트를 열 때 기록을 하나 쌓고, 닫는 길은 모두 history.back() 하나로 모은다 (ESC·닫기·바깥 누르기·뒤로가기 → popstate → onClose).
export function useSheet(onClose: () => void) {
  const ref = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.focus()
    // StrictMode가 효과를 두 번 돌려도 기록이 두 개 쌓이지 않게 한다
    if (!(history.state as { sheet?: boolean } | null)?.sheet) {
      history.pushState({ ...(history.state as object | null), sheet: true }, '')
    }
    const onPop = () => onCloseRef.current()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') history.back()
    }
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
      opener?.focus()
    }
  }, [])

  // 시트를 닫고 나서 할 일이 있으면(장소·경로 고르기) 기록이 정리된 뒤에 한다. 먼저 하면 화면 기록이 시트 기록 위에 쌓인다
  const dismiss = (then?: () => void) => {
    if (then) window.addEventListener('popstate', then, { once: true })
    history.back()
  }

  return { ref, dismiss }
}
