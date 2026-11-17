import { useEffect, useState } from 'react'
import { useSheet } from '../hooks/useSheet'
import type { User } from '../../../../shared/types'
import { PROVIDER_NAME, type DeleteResult } from '../lib/auth'
import { IN_APP_GOOGLE_NOTICE, needsGoogleInAppNotice } from '../lib/socialLogin'

type Props = {
  user: User
  onLogout: () => void
  onDelete: () => Promise<DeleteResult> // 탈퇴. 네이버·구글은 서비스 확인 화면으로 넘어가서(redirecting) 결과는 돌아온 뒤 지도 홈에 안내한다
  onDeleted: () => void // 탈퇴가 끝난 뒤 화면 정리
  onClose: () => void
}

// 회원의 [내 정보] 시트. 닉네임·이메일, 로그아웃, 회원 탈퇴 (FR-011)
export default function MyInfo({ user, onLogout, onDelete, onDeleted, onClose }: Props) {
  const { ref, dismiss } = useSheet(onClose)
  const [confirming, setConfirming] = useState(false)
  const [failed, setFailed] = useState(false)
  const [leaving, setLeaving] = useState(false) // 서비스 확인 화면으로 넘어가는 중
  const name = PROVIDER_NAME[user.provider]

  // 서비스 확인 화면에서 뒤로 가기로 돌아오면 브라우저가 이 화면을 그대로 되살려(bfcache) 버튼이 막힌 채 남는다. 다시 누를 수 있게 푼다
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLeaving(false)
    }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  const remove = async () => {
    setFailed(false)
    const result = await onDelete()
    if (result === 'deleted') dismiss(onDeleted)
    else if (result === 'redirecting') setLeaving(true)
    else setFailed(true)
  }

  return (
    <div className="myinfo-backdrop" onClick={() => dismiss()}>
      <section ref={ref} tabIndex={-1} className="myinfo" role="dialog" aria-modal="true" aria-label="내 정보" onClick={(e) => e.stopPropagation()}>
        <h2>{user.nickname}</h2>
        <p>{user.email ?? `${name}로 로그인함`}</p>
        {confirming ? (
          <>
            <p className="myinfo-warn">탈퇴하면 계정과 즐겨찾기가 지워져요. 되돌릴 수 없어요.</p>
            {/* 네이버·구글은 연결을 끊으려면 그 서비스 로그인을 한 번 더 거쳐야 한다 (lib/auth.ts) */}
            {user.provider !== 'kakao' && <p className="myinfo-warn">탈퇴하기를 누르면 {name}에서 한 번 더 확인해요.</p>}
            {user.provider === 'google' && needsGoogleInAppNotice() && <p className="myinfo-warn">{IN_APP_GOOGLE_NOTICE}</p>}
            {failed && (
              <p className="myinfo-warn" role="status">
                탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요.
              </p>
            )}
            <div className="myinfo-acts">
              <button
                type="button"
                onClick={() => {
                  setConfirming(false)
                  setFailed(false)
                  setLeaving(false)
                }}
              >
                취소
              </button>
              <button type="button" className="danger" onClick={remove} disabled={leaving}>
                탈퇴하기
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="myinfo-acts">
              <button type="button" onClick={() => dismiss()}>
                닫기
              </button>
              <button type="button" className="logout" onClick={() => dismiss(onLogout)}>
                로그아웃
              </button>
            </div>
            <button type="button" className="myinfo-delete" onClick={() => setConfirming(true)}>
              회원 탈퇴
            </button>
          </>
        )}
      </section>
    </div>
  )
}
