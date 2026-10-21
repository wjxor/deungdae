import { useEffect, useState } from 'react'
import type { Mode } from '../../../../shared/types'
import { fetchDaylight } from '../lib/api'

// 주야간: 서버가 알려 준 값이 기본이고, 사용자가 누르면 그 값이 우선한다 (FR-005)
export function useDaylightMode() {
  const [daylight, setDaylight] = useState<{ auto: Mode; sunrise: string; sunset: string } | null>(null)
  const [manual, setManual] = useState<Mode | null>(null)
  const mode: Mode = manual ?? daylight?.auto ?? 'day'

  useEffect(() => {
    let cancelled = false
    fetchDaylight()
      .then((d) => !cancelled && setDaylight({ auto: d.isNight ? 'night' : 'day', sunrise: d.sunrise, sunset: d.sunset }))
      .catch(() => {
        // 못 받으면 낮으로 두고, 사용자가 직접 바꿀 수 있다
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { mode, sunrise: daylight?.sunrise ?? null, sunset: daylight?.sunset ?? null, setMode: setManual }
}
