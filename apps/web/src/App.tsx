import { useState } from 'react'
import type { LatLng, Place } from '../../../shared/types'
import { useDaylightMode } from './hooks/useDaylightMode'
import { useGeolocation } from './hooks/useGeolocation'
import { useAuth } from './lib/auth'
import Login from './screens/Login'
import MapHome from './screens/MapHome'
import type { Origin } from './screens/OriginPick'
import OriginPick from './screens/OriginPick'
import RouteCompare from './screens/RouteCompare'

// 화면을 오가도 남겨야 하는 값(낮/밤, 현재 위치, 도착지, 출발지)은 여기서 들고 있고, 화면은 받아서 쓴다
export default function App() {
  const geo = useGeolocation()
  const daylight = useDaylightMode()
  const auth = useAuth()
  const [destination, setDestination] = useState<Place | null>(null)
  const [screen, setScreen] = useState<'login' | 'home' | 'origin' | 'route'>('login')
  // S2에서 검색해 고른 출발지. 없으면 현재 위치를 출발지로 쓴다
  const [pickedOrigin, setPickedOrigin] = useState<Place | null>(null)
  const [trip, setTrip] = useState<{ origin: LatLng; originLabel: string } | null>(null)

  const myLocation = geo.state.status === 'ready' ? geo.state.location : null
  const origin: Origin | null = pickedOrigin
    ? { location: pickedOrigin.location, label: pickedOrigin.name }
    : myLocation
      ? { location: myLocation, label: '현재 위치' }
      : null

  // [경로 찾기]를 누른 순간의 출발지. 이후 위치가 잡혀도 요청·상단 이름·지도 중심이 같은 값을 쓴다
  const findRoute = () => {
    if (!origin) return
    setTrip({ origin: origin.location, originLabel: origin.label })
    setScreen('route')
  }

  // 로그인하면 회원, "로그인 없이 시작하기"면 비회원(auth.user가 null)으로 지도 홈에 들어간다
  if (screen === 'login') {
    return (
      <Login
        onLogin={async (provider) => {
          const ok = await auth.login(provider)
          if (ok) setScreen('home')
          return ok
        }}
        onGuest={() => setScreen('home')}
      />
    )
  }

  if (screen === 'route' && destination && trip) {
    return (
      <RouteCompare
        origin={trip.origin}
        originLabel={trip.originLabel}
        myLocation={myLocation}
        destination={destination}
        daylight={daylight}
        onBack={() => setScreen('origin')}
      />
    )
  }

  if (screen === 'origin' && destination) {
    return (
      <OriginPick
        geo={geo}
        daylight={daylight}
        origin={origin}
        isCurrent={!pickedOrigin}
        destination={destination}
        onPickOrigin={setPickedOrigin}
        onUseCurrent={() => setPickedOrigin(null)}
        onBack={() => setScreen('home')}
        onFindRoute={findRoute}
      />
    )
  }

  return (
    <MapHome
      geo={geo}
      daylight={daylight}
      destination={destination}
      onPickDestination={setDestination}
      onFindRoute={() => setScreen('origin')}
      user={auth.user}
      onLogout={() => {
        auth.logout()
        setScreen('login')
      }}
      onDelete={async () => {
        const ok = await auth.deleteAccount()
        if (ok) setScreen('login')
        return ok
      }}
    />
  )
}
