import { useState } from 'react'
import type { User } from '../../../../shared/types'

type Props = {
  user: User
  onLogout: () => void
  onDelete: () => Promise<boolean> // 탈퇴. 성공하면 true
  onClose: () => void
}

// 회원의 [내 정보] 시트. 닉네임·이메일과 로그아웃만 둔다 (FR-011)
export default function MyInfo({ user, onLogout, onDelete, onClose }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [failed, setFailed] = useState(false)

  const remove = async () => {
    setFailed(false)
    if (!(await onDelete())) setFailed(true)
  }

  return (
    <div className="myinfo-backdrop" onClick={onClose}>
      <section className="myinfo" role="dialog" aria-label="내 정보" onClick={(e) => e.stopPropagation()}>
        <h2>{user.nickname}</h2>
        <p>{user.email}</p>
        {confirming ? (
          <>
            <p className="myinfo-warn">탈퇴하면 계정과 제보·즐겨찾기 기록이 지워져요. 되돌릴 수 없어요.</p>
            {failed && (
              <p className="myinfo-warn" role="status">
                탈퇴는 아직 준비 중이에요.
              </p>
            )}
            <div className="myinfo-acts">
              <button type="button" onClick={() => setConfirming(false)}>
                취소
              </button>
              <button type="button" className="danger" onClick={remove}>
                탈퇴하기
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="myinfo-acts">
              <button type="button" onClick={onClose}>
                닫기
              </button>
              <button type="button" className="logout" onClick={onLogout}>
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
