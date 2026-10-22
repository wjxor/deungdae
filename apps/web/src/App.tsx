import { useState } from 'react'
import type { LatLng, Place } from '../../../shared/types'
import { useDaylightMode } from './hooks/useDaylightMode'
import { useGeolocation } from './hooks/useGeolocation'
import { DAEJEON_CENTER } from './lib/geo'
import MapHome from './screens/MapHome'
import RouteCompare from './screens/RouteCompare'

// 화면을 오가도 남겨야 하는 값(낮/밤, 현재 위치, 도착지)은 여기서 들고 있고, 화면은 받아서 쓴다
export default function App() {
  const geo = useGeolocation()
  const daylight = useDaylightMode()
  const [destination, setDestination] = useState<Place | null>(null)
  const [screen, setScreen] = useState<'home' | 'route'>('home')
  const [trip, setTrip] = useState<{ origin: LatLng; originLabel: string } | null>(null)

  // [경로 찾기]를 누른 순간의 출발지. 이후 위치가 잡혀도 요청·상단 이름·지도 중심이 같은 값을 쓴다
  const myLocation = geo.state.status === 'ready' ? geo.state.location : null
  const findRoute = () => {
    setTrip(myLocation ? { origin: myLocation, originLabel: '현재 위치' } : { origin: DAEJEON_CENTER, originLabel: '대전시청' })
    setScreen('route')
  }

  if (screen === 'route' && destination && trip) {
    return (
      <RouteCompare
        origin={trip.origin}
        originLabel={trip.originLabel}
        myLocation={myLocation}
        destination={destination}
        daylight={daylight}
        onBack={() => setScreen('home')}
      />
    )
  }

  return (
    <MapHome
      geo={geo}
      daylight={daylight}
      destination={destination}
      onPickDestination={setDestination}
      onFindRoute={findRoute}
    />
  )
}
