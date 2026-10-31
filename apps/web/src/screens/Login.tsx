import { useState } from 'react'
import type { SocialProvider } from '../lib/auth'
import { PROVIDERS } from '../lib/auth'
import SocialLogo from '../components/SocialLogo'

type Props = {
  onLogin: (provider: SocialProvider) => Promise<boolean>
  onGuest: () => void // 로그인하지 않고 지도로 간다 (비회원)
}

// 소셜 로그인 화면 (FR-011). 앱을 켜면 S1보다 먼저 나온다. 로그인 처리는 서버가 하고, 여기는 버튼만 둔다
export default function Login({ onLogin, onGuest }: Props) {
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
            <button key={p.value} type="button" className={`social ${p.value}`} onClick={() => pick(p.value)}>
              <SocialLogo provider={p.value} />
              <span>{p.label}</span>
            </button>
          ))}
        </div>

        {failed && (
          <p className="notice" role="status">
            로그인은 아직 준비 중이에요. 로그인 없이 경로를 찾을 수 있어요.
          </p>
        )}

        <button type="button" className="login-guest" onClick={onGuest}>
          로그인 없이 시작하기
        </button>
      </div>
    </main>
  )
}
