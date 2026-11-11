import { usePwaInstall } from '../hooks/usePwaInstall'

// 홈 화면 설치 안내. 설치는 선택이라 닫을 수 있고, 닫으면 다시 보여 주지 않는다
export default function InstallHint() {
  const { state, dismiss } = usePwaInstall()
  if (state.kind === 'none') return null

  return (
    <p className="notice install-hint" role="status">
      {state.kind === 'prompt' ? (
        <>
          홈 화면에 추가하면 앱처럼 사용할 수 있어요
          <button type="button" onClick={state.install}>
            추가
          </button>
        </>
      ) : (
        // 사파리 탭 배치에 따라 공유가 ⋯(페이지 메뉴) 안에 있거나 따로 버튼으로 있다
        <>사파리 공유 버튼(없으면 ⋯ → 공유)에서 "홈 화면에 추가"를 누르면 앱처럼 사용할 수 있어요</>
      )}
      <button type="button" onClick={dismiss}>
        닫기
      </button>
    </p>
  )
}
