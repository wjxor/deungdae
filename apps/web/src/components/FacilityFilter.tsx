import { useEffect, useId, useRef, useState } from 'react'
import type { FacilityType } from '../../../../shared/types'
import { FACILITY_ICONS, FACILITY_TYPES } from '../lib/facilityIcon'

type Props = {
  visible: Record<FacilityType, boolean>
  onToggle: (type: FacilityType) => void
}

// 안심시설 종류별 표시 on/off (FR-002). 평소엔 작은 버튼 하나이고, 누르면 목록과 스위치가 펼쳐진다.
// 버튼의 점 세 개가 어떤 종류가 켜져 있는지 펼치지 않고도 알려 준다.
export default function FacilityFilter({ visible, onToggle }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const onCount = FACILITY_TYPES.filter((t) => visible[t]).length

  // 바깥(지도 빈 곳 포함)을 누르거나 Esc를 누르면 닫는다. 지도가 이벤트를 막아도 받도록 capture로 듣는다
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="ffilter" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="fpill"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`안심시설 표시, ${FACILITY_TYPES.length}종류 중 ${onCount}종류 켜짐`}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l9 5-9 5-9-5z" />
          <path d="M3 13l9 5 9-5" />
        </svg>
        안심시설
        <span className="fdots" aria-hidden="true">
          {FACILITY_TYPES.map((t) => (
            <i key={t} className={`fdot ${t}`} data-on={visible[t]} />
          ))}
        </span>
      </button>

      {open && (
        <div className="fpop" id={panelId} role="group" aria-label="안심시설 종류별 표시">
          {FACILITY_TYPES.map((type) => {
            const { short, path } = FACILITY_ICONS[type]
            return (
              <button key={type} type="button" className={`frow ${type}`} role="switch" aria-checked={visible[type]} onClick={() => onToggle(type)}>
                {/* path는 facilityIcon.ts에 적힌 고정 문자열이다. 사용자 입력이 들어가지 않는다 */}
                <span className="badge">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: path }} />
                </span>
                <span className="fname">{short}</span>
                <span className="fsw" aria-hidden="true" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
