import { useState } from 'react'
import type { SocialProvider } from '../lib/auth'
import { LOGIN_FAILED_MESSAGE, PROVIDERS } from '../lib/auth'
import SocialLogo from '../components/SocialLogo'

type Props = {
  error: string | null // 카카오에서 돌아왔는데 로그인이 실패했을 때의 안내
  onLogin: (provider: SocialProvider) => Promise<boolean> // 카카오로 넘어가면 true, 카카오 SDK를 못 불러오면 false
  onGuest: () => void // 로그인하지 않고 지도로 간다 (비회원)
}

// 소셜 로그인 화면 (FR-011). S1 하단의 [로그인]으로 들어오고, 카카오 로그인이 실패해 돌아왔을 때도 열린다. 로그인 처리는 서버가 하고, 여기는 버튼만 둔다
export default function Login({ error, onLogin, onGuest }: Props) {
  const [failed, setFailed] = useState(false)

  const pick = async (provider: SocialProvider) => {
    setFailed(false)
    if (!(await onLogin(provider))) setFailed(true)
  }

  return (
    <main className="login">
      <div className="login-body">
        <h1>등대</h1>
        <p className="login-lead">로그인하면 위험 구간을 제보하고 즐겨찾기를 쓸 수 있어요. 경로 찾기는 로그인 없이도 돼요.</p>

        <div className="login-buttons">
          {PROVIDERS.map((p) => (
            <button key={p.value} type="button" className={`social ${p.value}`} disabled={!p.ready} aria-label={p.ready ? undefined : `${p.label} 로그인 준비 중`} onClick={() => pick(p.value)}>
              <SocialLogo provider={p.value} />
              <span>{p.ready ? p.label : '준비 중'}</span>
            </button>
          ))}
        </div>

        {(failed || error) && (
          <p className="notice" role="status">
            {LOGIN_FAILED_MESSAGE} 로그인 없이도 경로를 찾을 수 있어요.
          </p>
        )}

        <button type="button" className="login-guest" onClick={onGuest}>
          로그인 없이 시작하기
        </button>
      </div>
    </main>
  )
}
