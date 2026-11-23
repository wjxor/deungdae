import { useState } from 'react'
import type { LatLng, ReportType } from '../../../../shared/types'
import KakaoMap from '../components/KakaoMap'
import type { useDaylightMode } from '../hooks/useDaylightMode'
import type { useGeolocation } from '../hooks/useGeolocation'
import { DAEJEON_CENTER, isInDaejeonRect } from '../lib/geo'
import { NO_FACILITIES } from '../lib/facilityIcon'

type Props = {
  geo: ReturnType<typeof useGeolocation>
  daylight: ReturnType<typeof useDaylightMode>
  onBack: () => void
}

// 우범지역은 기준이 애매하고 범죄다발구역 데이터도 없어 뺐다 (2026-11-23 상협·승민)
const TYPES: { value: ReportType; label: string }[] = [
  { value: 'dark', label: '조명 부족' },
  { value: 'no_cctv', label: 'CCTV 없음' },
  { value: 'others', label: '기타' },
]

const DESCRIPTION_MAX = 200

// S4 위험 제보 (FR-009). 임시 화면이다 — 서버 `/reports`(API.md 6장)가 없어서 보내지 않고, 제보 로그인·사진·점수 반영은 팀이 정한 뒤 붙인다
export default function ReportScreen({ geo, daylight, onBack }: Props) {
  const myLocation = geo.state.status === 'ready' ? geo.state.location : null
  // 지도를 눌러 고른 곳. 없으면 현재 위치를 쓴다
  const [picked, setPicked] = useState<LatLng | null>(null)
  const [heldCenter, setHeldCenter] = useState<LatLng | null>(null)
  const [type, setType] = useState<ReportType | null>(null)
  const [description, setDescription] = useState('')
  const [outside, setOutside] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const location = picked ?? myLocation
  const center = heldCenter ?? location ?? DAEJEON_CENTER
  const canSubmit = location !== null && type !== null && isInDaejeonRect(location)

  // 누른 자리로 지도가 옮겨 가지 않게 처음 누를 때의 중심을 붙잡아 둔다 (S1·S2와 같다)
  const pickOnMap = (point: LatLng, mapCenter: LatLng) => {
    if (!isInDaejeonRect(point)) {
      setOutside(true)
      return
    }
    setOutside(false)
    setSubmitted(false)
    setHeldCenter((held) => held ?? mapCenter)
    setPicked(point)
  }

  const useCurrent = () => {
    setPicked(null)
    setHeldCenter(null)
    setOutside(false)
  }

  const notice = outside
    ? '대전 안에서만 위치를 고를 수 있어요.'
    : location
      ? null
      : geo.state.status === 'loading'
        ? null
        : '현재 위치를 가져오지 못했어요. 지도를 눌러 위치를 골라 주세요.'

  return (
    <main className="map-home report-screen" data-mode={daylight.mode}>
      <div className="map-area">
        <KakaoMap center={center} myLocation={myLocation} pin={location} facilityVisible={NO_FACILITIES} onMapClick={pickOnMap} />

        <header className="top">
          <div className="route-head">
            <button type="button" className="back" aria-label="뒤로" onClick={onBack}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <strong className="report-title">위험 제보</strong>
          </div>
          {!outside && (
            <p className="map-pick-hint">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
              </svg>
              {picked ? '고른 위치예요. 다시 누르면 옮겨요' : '지도를 눌러 위험한 곳을 골라 주세요'}
            </p>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
              {!outside && geo.state.status === 'unavailable' && (
                <button type="button" onClick={geo.retry}>
                  다시 시도
                </button>
              )}
            </p>
          )}
        </header>
      </div>

      <section className="sheet" aria-label="제보 입력">
        {picked && myLocation && (
          <button type="button" className="text-btn" onClick={useCurrent}>
            현재 위치로 하기
          </button>
        )}
        <div className="report-types" role="radiogroup" aria-label="제보 유형">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={type === t.value}
              onClick={() => {
                setType(t.value)
                setSubmitted(false)
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <textarea
          className="report-desc"
          rows={2}
          maxLength={DESCRIPTION_MAX}
          placeholder="어떤 점이 위험한지 적어 주세요 (선택)"
          aria-label="제보 설명"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {submitted && (
          <p className="notice" role="status">
            제보 저장은 아직 준비 중이에요. 지금은 화면만 볼 수 있어요.
          </p>
        )}
        <div className="acts">
          <button type="button" className="route" disabled={!canSubmit} onClick={() => setSubmitted(true)}>
            제보하기
          </button>
        </div>
      </section>
    </main>
  )
}
