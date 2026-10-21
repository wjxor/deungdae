import { useEffect, useState } from 'react'
import type { LatLng, Place } from '../../../../shared/types'
import { searchPlaces } from '../lib/api'

type Props = {
  near: LatLng | null
  onPick: (place: Place) => void
}

type Result = { q: string; places: Place[] } | { q: string; error: string }

// 장소·주소 검색. 입력 후 300ms 뒤에 검색한다 (FR-003)
export default function PlaceSearch({ near, onPick }: Props) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  const q = query.trim()

  useEffect(() => {
    if (!q) return
    let cancelled = false
    const timer = setTimeout(() => {
      searchPlaces(q, near ?? undefined)
        .then((res) => !cancelled && setResult({ q, places: res.places }))
        .catch((e: Error) => !cancelled && setResult({ q, error: e.message }))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // near는 정렬 힌트라서 위치가 바뀐다고 다시 검색하지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  // 입력이 비었거나, 방금 고른 장소 이름이 입력칸에 들어간 상태면 목록을 닫는다
  const current = q && q !== picked && result?.q === q ? result : null

  const pick = (place: Place) => {
    setPicked(place.name)
    setQuery(place.name)
    onPick(place)
  }

  return (
    <div className="place-search">
      <div className="search-box">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="어디로 갈까요?"
          aria-label="장소 검색"
          enterKeyHint="search"
        />
      </div>
      {current && (
        <ul className="search-results">
          {'error' in current && <li className="empty">{current.error}</li>}
          {'places' in current && current.places.length === 0 && <li className="empty">검색 결과가 없어요</li>}
          {'places' in current &&
            current.places.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => pick(p)}>
                  <strong>{p.name}</strong>
                  <span>{p.address}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
