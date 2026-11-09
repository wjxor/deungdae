import { useCallback, useEffect, useState } from 'react'
import type { Mode } from '../../../../shared/types'
import { fetchDaylight } from '../lib/api'
import { isNightAt, isStale, nextCheckAt } from '../lib/daylight'

// 주야간: 서버가 알려 준 일출·일몰이 기본이고, 사용자가 누르면 그 값이 우선한다 (FR-005).
// 앱을 켜 둔 채 일몰·일출이 지나도 바뀌도록, 받아 둔 시각을 기기 시각과 비교해 다시 판별한다 (API.md 1-1장).
// 사용자가 고른 값은 일출·일몰이 지나 자동 값이 바뀌면 버리고 다시 자동으로 따른다
export function useDaylightMode() {
  const [daylight, setDaylight] = useState<{ sunrise: string; sunset: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // 사용자가 고른 값과, 그때 보이던 자동 값. 자동 값이 그 뒤에 달라졌으면 선택은 끝난 것으로 본다
  const [manual, setManual] = useState<{ mode: Mode; basedOn: Mode } | null>(null)
  const auto: Mode = daylight ? (isNightAt(now, daylight.sunrise, daylight.sunset) ? 'night' : 'day') : 'day'
  const mode: Mode = manual && manual.basedOn === auto ? manual.mode : auto
  const setMode = useCallback((next: Mode) => setManual({ mode: next, basedOn: auto }), [auto])

  const load = useCallback(() => {
    fetchDaylight()
      .then((d) => {
        setDaylight({ sunrise: d.sunrise, sunset: d.sunset })
        setNow(Date.now())
      })
      .catch(() => {
        // 못 받으면 지금 값을 두고, 사용자가 직접 바꿀 수 있다
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // 다음 일출·일몰(없으면 한국 자정)에 다시 판별한다. 날짜가 바뀌어 받아 둔 시각이 어제 것이면 새로 받는다
  useEffect(() => {
    if (!daylight) return
    if (isStale(now, daylight.sunset)) {
      load()
      return
    }
    const id = setTimeout(() => setNow(Date.now()), nextCheckAt(now, daylight.sunrise, daylight.sunset) - now + 1000)
    return () => clearTimeout(id)
  }, [daylight, now, load])

  // 폰 화면을 꺼 두면 타이머가 멈춰서, 다시 켜면 바로 판별한다
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  return { mode, sunrise: daylight?.sunrise ?? null, sunset: daylight?.sunset ?? null, setMode }
}
