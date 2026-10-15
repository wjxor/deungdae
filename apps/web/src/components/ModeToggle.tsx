import type { Mode } from '../../../../shared/types'

type Props = {
  mode: Mode
  sunset: string | null // ISO 8601 (2026-10-15T18:14:00+09:00)
  manual: boolean // 사용자가 직접 고른 상태인지
  onChange: (mode: Mode) => void
}

const OPTIONS: { value: Mode; label: string }[] = [
  { value: 'day', label: '낮' },
  { value: 'night', label: '밤' },
]

// 낮/밤 전환 토글. 기본값은 일몰 시각으로 정해지고, 사용자가 누르면 그 값이 우선한다 (FR-005)
export default function ModeToggle({ mode, sunset, manual, onChange }: Props) {
  const time = sunset ? sunset.slice(11, 16) : null
  const hint = manual ? '직접 선택' : time ? (mode === 'night' ? `일몰 ${time} 이후` : `일몰 ${time}까지`) : null

  return (
    <div className="mode" role="group" aria-label="낮 밤 전환">
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" aria-pressed={mode === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
      {hint && <span className="mode-hint">{hint}</span>}
    </div>
  )
}
