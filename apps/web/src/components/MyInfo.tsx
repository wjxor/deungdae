import type { User } from '../../../../shared/types'

type Props = {
  user: User
  onLogout: () => void
  onClose: () => void
}

// 회원의 [내 정보] 시트. 닉네임·이메일과 로그아웃만 둔다 (FR-011)
export default function MyInfo({ user, onLogout, onClose }: Props) {
  return (
    <div className="myinfo-backdrop" onClick={onClose}>
      <section className="myinfo" role="dialog" aria-label="내 정보" onClick={(e) => e.stopPropagation()}>
        <h2>{user.nickname}</h2>
        <p>{user.email}</p>
        <div className="myinfo-acts">
          <button type="button" onClick={onClose}>
            닫기
          </button>
          <button type="button" className="logout" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      </section>
    </div>
  )
}
