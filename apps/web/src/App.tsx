import { useEffect, useState } from 'react'
import type { LatLng, Place } from '../../../shared/types'
import { useDaylightMode } from './hooks/useDaylightMode'
import { useGeolocation } from './hooks/useGeolocation'
import { useAuth } from './lib/auth'
import type { FavoriteRoute } from './lib/favorites'
import { useFavorites } from './lib/favorites'
import Login from './screens/Login'
import MapHome from './screens/MapHome'
import type { Origin } from './screens/OriginPick'
import OriginPick from './screens/OriginPick'
import RouteCompare from './screens/RouteCompare'

type Screen = 'login' | 'home' | 'origin' | 'route'

// 화면을 오가도 남겨야 하는 값(낮/밤, 현재 위치, 도착지, 출발지)은 여기서 들고 있고, 화면은 받아서 쓴다
export default function App() {
  const geo = useGeolocation()
  const daylight = useDaylightMode()
  const auth = useAuth()
  const favorites = useFavorites()
  const [destination, setDestination] = useState<Place | null>(null)
  const [screen, setScreen] = useState<Screen>('login')

  // 화면 전환을 브라우저 기록에 남겨서 뒤로가기가 앱 밖이 아니라 앞 화면으로 돌아가게 한다.
  // 로그인·로그아웃은 기록을 덮어써서 뒤로가기로 로그인 화면에 되돌아가지 않는다
  const go = (next: Screen, how: 'push' | 'replace' = 'push') => {
    if (how === 'push') history.pushState({ screen: next }, '')
    else history.replaceState({ screen: next }, '')
    setScreen(next)
  }
  useEffect(() => {
    history.replaceState({ screen: 'login' }, '')
    const onPop = (e: PopStateEvent) => setScreen((e.state as { screen?: Screen } | null)?.screen ?? 'login')
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  // S2에서 검색해 고른 출발지. 없으면 현재 위치를 출발지로 쓴다
  const [pickedOrigin, setPickedOrigin] = useState<Place | null>(null)
  const [trip, setTrip] = useState<{ origin: LatLng; originLabel: string; originPlace: Place | null } | null>(null)

  // 로그아웃·탈퇴하면 그 사람이 고른 도착지·출발지·즐겨찾기가 다음 사람 화면에 남지 않게 비운다
  const endSession = () => {
    favorites.clear()
    setDestination(null)
    setPickedOrigin(null)
    setTrip(null)
    go('login', 'replace')
  }

  const myLocation = geo.state.status === 'ready' ? geo.state.location : null
  const origin: Origin | null = pickedOrigin
    ? { location: pickedOrigin.location, label: pickedOrigin.name }
    : myLocation
      ? { location: myLocation, label: '현재 위치' }
      : null

  // [경로 찾기]를 누른 순간의 출발지. 이후 위치가 잡혀도 요청·상단 이름·지도 중심이 같은 값을 쓴다
  const findRoute = () => {
    if (!origin) return
    setTrip({ origin: origin.location, originLabel: origin.label, originPlace: pickedOrigin })
    go('route')
  }

  // 로그인하면 회원, "로그인 없이 시작하기"면 비회원(auth.user가 null)으로 지도 홈에 들어간다
  if (screen === 'login') {
    return (
      <Login
        onLogin={async (provider) => {
          const ok = await auth.login(provider)
          if (ok) go('home', 'replace')
          return ok
        }}
        onGuest={() => go('home', 'replace')}
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
        favorite={
          auth.user
            ? {
                on: favorites.hasRoute(trip.originPlace, destination),
                onToggle: () => favorites.toggleRoute(trip.originPlace, trip.originLabel, destination),
              }
            : undefined
        }
        onBack={() => history.back()}
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
        onBack={() => history.back()}
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
      onFindRoute={() => go('origin')}
      user={auth.user}
      favorites={favorites}
      onPickFavoriteRoute={(route: FavoriteRoute) => {
        setDestination(route.destination)
        setPickedOrigin(route.origin) // null이면 현재 위치에서 출발
        go('origin')
      }}
      onLogout={() => {
        auth.logout()
        endSession()
      }}
      onDelete={async () => {
        const ok = await auth.deleteAccount()
        if (ok) endSession()
        return ok
      }}
    />
  )
}
