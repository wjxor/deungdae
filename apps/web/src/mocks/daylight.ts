import type { DaylightResponse } from '../../../../shared/types'

// 목 데이터. 일출·일몰 시각은 API.md 1-1장 응답 예시(06:27, 18:14)를 오늘 날짜에 붙인 것이다.
// 서버(GET /daylight)가 생기면 이 파일은 지운다.
export function mockDaylight(): DaylightResponse {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const sunrise = `${day}T06:27:00+09:00`
  const sunset = `${day}T18:14:00+09:00`
  const now = Date.now()
  return { sunrise, sunset, isNight: now < Date.parse(sunrise) || now > Date.parse(sunset) }
}
