import type { SocialProvider } from '../lib/auth'

// 소셜 로그인 버튼 앞에 붙는 로고. 장식이라 스크린리더에는 읽히지 않게 한다 (버튼 글자가 이름)
export default function SocialLogo({ provider }: { provider: SocialProvider }) {
  return (
    <svg className="social-logo" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      {provider === 'kakao' && (
        <path
          fill="#191919"
          d="M12 3C6.48 3 2 6.58 2 11c0 2.86 1.87 5.37 4.68 6.78l-.95 3.5c-.08.3.26.54.52.36l4.16-2.76c.52.07 1.05.12 1.59.12 5.52 0 10-3.58 10-8S17.52 3 12 3z"
        />
      )}
      {provider === 'naver' && <path fill="#fff" d="M16.27 12.85 7.4 3H3v18h4.73v-9.85L16.6 21H21V3h-4.73z" />}
      {provider === 'google' && (
        <>
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.83z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z" />
        </>
      )}
    </svg>
  )
}
