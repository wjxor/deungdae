import { useState } from 'react'
import type { Place } from '../../../shared/types'
import { useDaylightMode } from './hooks/useDaylightMode'
import { useGeolocation } from './hooks/useGeolocation'
import MapHome from './screens/MapHome'

// 화면을 오가도 남겨야 하는 값(낮/밤, 현재 위치, 도착지)은 여기서 들고 있고, 화면은 받아서 쓴다
export default function App() {
  const geo = useGeolocation()
  const daylight = useDaylightMode()
  const [destination, setDestination] = useState<Place | null>(null)

  return <MapHome geo={geo} daylight={daylight} destination={destination} onPickDestination={setDestination} />
}
