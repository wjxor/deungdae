import { useEffect, useState } from 'react'
import type { LatLng } from '../../../../shared/types'
import { useSheet } from '../hooks/useSheet'

type Props = {
  myLocation: LatLng | null // 앱을 켤 때 잡아 둔 위치. 시트를 열면 새로 잡아 보고, 못 잡으면 이 값을 쓴다
  onClose: () => void
}

// 카카오맵 링크. 문자 받는 사람이 누르면 그 자리가 지도에 뜬다 (앱이 없으면 웹 지도)
function mapLink({ lat, lng }: LatLng) {
  return `https://map.kakao.com/link/map/${encodeURIComponent('내 위치')},${lat},${lng}`
}

// 문자 앱이 받는 사람 없이, 본문만 채워진 채로 열린다. `sms:?&body=`는 아이폰·안드로이드 둘 다 본문을 읽는 형식이다
function smsHref(location: LatLng) {
  return `sms:?&body=${encodeURIComponent(`[등대] 위험해서 도움이 필요해요. 지금 제 위치예요: ${mapLink(location)}`)}`
}

// S1 SOS 시트 (FR-014). 서버 없이 전화 앱과 문자 앱을 여는 것까지만 한다 — 통화와 문자는 사용자가 직접 누른다.
// 누르자마자 걸리지 않게 시트를 한 번 거친다
export default function SosSheet({ myLocation, onClose }: Props) {
  const { ref, dismiss } = useSheet(onClose)
  const [fresh, setFresh] = useState<LatLng | null>(null)
  const location = fresh ?? myLocation

  useEffect(() => {
    if (!('geolocation' in navigator)) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setFresh({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}, // 실패해도 앞서 잡아 둔 위치로 보낸다
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 },
    )
  }, [])

  return (
    <div className="myinfo-backdrop" onClick={() => dismiss()}>
      <section ref={ref} tabIndex={-1} className="myinfo sos-sheet" role="dialog" aria-modal="true" aria-label="SOS" onClick={(e) => e.stopPropagation()}>
        <h2>도움이 필요하세요?</h2>
        <p>전화 앱과 문자 앱이 열려요. 통화와 문자는 직접 눌러야 걸리고 보내져요.</p>
        <div className="sos-acts">
          <a className="sos-call" href="tel:112">
            112에 전화
          </a>
          {location ? (
            <a className="sos-share" href={smsHref(location)}>
              보호자에게 위치 보내기
            </a>
          ) : (
            <span className="sos-share" aria-disabled="true">
              보호자에게 위치 보내기
            </span>
          )}
        </div>
        {!location && <p className="sos-note">현재 위치를 아직 못 잡았어요. 위치 권한을 켜면 문자로 보낼 수 있어요.</p>}
        <button type="button" className="myinfo-delete" onClick={() => dismiss()}>
          닫기
        </button>
      </section>
    </div>
  )
}
