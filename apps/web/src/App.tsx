import { useState } from 'react'
import type { Place } from '../../../shared/types'
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

  if (screen === 'route' && destination) {
    const myLocation = geo.state.status === 'ready' ? geo.state.location : null
    return (
      <RouteCompare
        origin={myLocation ?? DAEJEON_CENTER}
        originLabel={myLocation ? '현재 위치' : '대전시청'}
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
      onFindRoute={() => setScreen('route')}
    />
  )
}
