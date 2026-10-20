import type { ReactNode } from 'react'
import type { Mode } from '../../../../shared/types'

type Props = {
  mode: Mode
  sunrise: string | null // ISO 8601 (2026-10-15T06:27:00+09:00)
  sunset: string | null // ISO 8601 (2026-10-15T18:14:00+09:00)
  onChange: (mode: Mode) => void
}

const OPTIONS: { value: Mode; label: string; icon: ReactNode }[] = [
  {
    value: 'day',
    label: '낮',
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19" />
      </>
    ),
  },
  { value: 'night', label: '밤', icon: <path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" /> },
]

// 낮/밤 전환 토글. 기본값은 일몰 시각으로 정해지고, 사용자가 누르면 그 값이 우선한다 (FR-005)
export default function ModeToggle({ mode, sunrise, sunset, onChange }: Props) {
  // 직접 골랐을 때도 같은 문구: 밤이면 일출, 낮이면 일몰 시각
  const iso = mode === 'night' ? sunrise : sunset
  const hint = iso ? `${mode === 'night' ? '일출' : '일몰'} ${iso.slice(11, 16)}` : null

  return (
    <div className="mode" role="group" aria-label="낮 밤 전환">
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" aria-pressed={mode === o.value} onClick={() => onChange(o.value)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {o.icon}
          </svg>
          {o.label}
        </button>
      ))}
      {hint && <span className="mode-hint">{hint}</span>}
    </div>
  )
}
