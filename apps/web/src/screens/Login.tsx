import { useState } from 'react'
import type { SocialProvider } from '../lib/auth'
import { loginFailedMessage, PROVIDERS } from '../lib/auth'
import { IN_APP_GOOGLE_NOTICE, needsGoogleInAppNotice } from '../lib/socialLogin'
import SocialLogo from '../components/SocialLogo'

type Props = {
  error: string | null // 로그인 서비스에서 돌아왔는데 로그인이 실패했을 때의 안내 (서비스 이름이 들어 있다)
  onLogin: (provider: SocialProvider) => Promise<boolean> // 서비스로 넘어가면 true, 카카오 SDK를 못 불러오거나 Client ID가 없으면 false
  onGuest: () => void // 로그인하지 않고 지도로 간다 (비회원)
}

// 소셜 로그인 화면 (FR-011). S1 하단의 [로그인]으로 들어오고, 로그인이 실패해 돌아왔을 때도 열린다. 로그인 처리는 서버가 하고, 여기는 버튼만 둔다
export default function Login({ error, onLogin, onGuest }: Props) {
  // 버튼을 눌렀는데 서비스로 넘어가지 못한 경우. 어느 서비스였는지 안내에 쓴다
  const [failedProvider, setFailedProvider] = useState<SocialProvider | null>(null)

  const pick = async (provider: SocialProvider) => {
    setFailedProvider(null)
    if (!(await onLogin(provider))) setFailedProvider(provider)
  }

  const message = failedProvider ? loginFailedMessage(failedProvider) : error

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

        {/* 구글은 앱 안 브라우저에서 로그인을 막는다. 카카오톡은 버튼을 누르면 외부 브라우저로 넘기고, 그 밖의 앱은 여기서 알린다 */}
        {needsGoogleInAppNotice() && (
          <p className="notice" role="note">
            {IN_APP_GOOGLE_NOTICE}
          </p>
        )}

        {message && (
          <p className="notice" role="status">
            {message} 로그인 없이도 경로를 찾을 수 있어요.
          </p>
        )}

        <button type="button" className="login-guest" onClick={onGuest}>
          로그인 없이 시작하기
        </button>
      </div>
    </main>
  )
}
