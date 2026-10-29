import { useEffect, useRef, useState } from 'react'
import type { FacilityType, LatLng } from '../../../../shared/types'
import { loadKakaoMaps } from '../lib/kakao'
import FacilityLayer from './FacilityLayer'
import RouteLayer, { type RouteView } from './RouteLayer'

type Props = {
  center: LatLng
  myLocation: LatLng | null
  pin: LatLng | null
  originPin?: LatLng | null // 출발지 핀 (S2 미리보기)
  facilityVisible: Record<FacilityType, boolean>
  route?: RouteView // 있으면 경로 화면(S3): 경로를 그리고 안심벨·지구대만 보이며 도착지 핀은 RouteLayer가 그린다
}

// 경로 화면에서는 직접 도움을 받을 수 있는 안심벨·지구대만 늘 보인다 (CCTV는 바텀시트 개수로만)
const ROUTE_FACILITY_VISIBLE: Record<FacilityType, boolean> = { cctv: false, emergency_bell: true, police: true }

const toKakao =(p: LatLng) => new kakao.maps.LatLng(p.lat, p.lng)

export default function KakaoMap({ center, myLocation, pin, originPin = null, facilityVisible, route }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const myOverlayRef = useRef<kakao.maps.CustomOverlay | null>(null)
  const pinOverlayRef = useRef<kakao.maps.CustomOverlay | null>(null)
  const originPinRef = useRef<kakao.maps.CustomOverlay | null>(null)
  const [map, setMap] = useState<kakao.maps.Map | null>(null)
  const inRoute = route !== undefined // 경로 화면이면 도착지 핀은 RouteLayer가 대신 그린다
  const [error, setError] = useState<string | null>(null)
  // 지도를 만들 때 쓸 중심. 이후 이동은 아래 effect가 맡는다
  const initialCenter = useRef(center)

  useEffect(() => {
    let cancelled = false
    loadKakaoMaps()
      .then((k) => {
        if (cancelled || !containerRef.current) return
        setMap(new k.maps.Map(containerRef.current, { center: toKakao(initialCenter.current), level: 4 }))
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 중심 이동. center가 새 객체로 바뀌면 다시 이동한다 ("내 위치" 버튼, 검색 결과)
  useEffect(() => {
    map?.setCenter(toKakao(center))
  }, [center, map])

  // 현재 위치 점
  useEffect(() => {
    if (!map) return
    myOverlayRef.current?.setMap(null)
    myOverlayRef.current = null
    if (!myLocation) return
    const dot = document.createElement('div')
    dot.className = 'my-location'
    myOverlayRef.current = new kakao.maps.CustomOverlay({
      position: toKakao(myLocation),
      content: dot,
      xAnchor: 0.5,
      yAnchor: 0.5,
      zIndex: 10,
    })
    myOverlayRef.current.setMap(map)
  }, [myLocation, map])

  // 검색해서 고른 장소의 핀
  useEffect(() => {
    if (!map) return
    pinOverlayRef.current?.setMap(null)
    pinOverlayRef.current = null
    if (!pin || inRoute) return
    const el = document.createElement('div')
    el.className = 'place-pin'
    pinOverlayRef.current = new kakao.maps.CustomOverlay({
      position: toKakao(pin),
      content: el,
      xAnchor: 0.5,
      yAnchor: 1,
      zIndex: 11,
    })
    pinOverlayRef.current.setMap(map)
  }, [pin, map, inRoute])

  // 출발지 핀
  useEffect(() => {
    if (!map) return
    originPinRef.current?.setMap(null)
    originPinRef.current = null
    if (!originPin || inRoute) return
    const el = document.createElement('div')
    el.className = 'place-pin origin'
    originPinRef.current = new kakao.maps.CustomOverlay({
      position: toKakao(originPin),
      content: el,
      xAnchor: 0.5,
      yAnchor: 1,
      zIndex: 11,
    })
    originPinRef.current.setMap(map)
  }, [originPin, map, inRoute])

  return (
    <>
      <div ref={containerRef} className="map" />
      {route && <RouteLayer map={map} view={route} />}
      <FacilityLayer map={map} visible={route ? ROUTE_FACILITY_VISIBLE : facilityVisible} wide={inRoute} />
      {error && (
        <p className="map-error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
