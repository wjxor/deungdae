import { useState } from 'react'
import type { Place } from '../../../../shared/types'
import type { FavoriteRoute } from '../lib/favorites'

type Props = {
  places: Place[]
  routes: FavoriteRoute[]
  onPickPlace: (place: Place) => void // 도착지로 고른다
  onPickRoute: (route: FavoriteRoute) => void // 출발지·도착지를 채워 S2로 간다
  onRemovePlace: (place: Place) => void
  onRemoveRoute: (id: string) => void
  onClose: () => void
}

// 즐겨찾기 목록 시트. 자주 가는 경로와 장소를 탭으로 나눈다 (FR-012)
export default function FavoritesSheet({ places, routes, onPickPlace, onPickRoute, onRemovePlace, onRemoveRoute, onClose }: Props) {
  const [tab, setTab] = useState<'route' | 'place'>('route')

  return (
    <div className="myinfo-backdrop" onClick={onClose}>
      <section className="myinfo" role="dialog" aria-label="즐겨찾기" onClick={(e) => e.stopPropagation()}>
        <div className="fav-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'route'} onClick={() => setTab('route')}>
            경로 {routes.length}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'place'} onClick={() => setTab('place')}>
            장소 {places.length}
          </button>
        </div>

        {tab === 'route' ? (
          routes.length === 0 ? (
            <p className="fav-empty">즐겨찾기한 경로가 없어요.</p>
          ) : (
            <ul className="fav-list">
              {routes.map((r) => (
                <li key={r.id}>
                  <button type="button" className="fav-item" onClick={() => onPickRoute(r)}>
                    {r.name}
                  </button>
                  <button type="button" className="fav-remove" aria-label={`${r.name} 즐겨찾기 해제`} onClick={() => onRemoveRoute(r.id)}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : places.length === 0 ? (
          <p className="fav-empty">즐겨찾기한 장소가 없어요.</p>
        ) : (
          <ul className="fav-list">
            {places.map((p) => (
              <li key={p.id}>
                <button type="button" className="fav-item" onClick={() => onPickPlace(p)}>
                  <strong>{p.name}</strong>
                  <span>{p.address}</span>
                </button>
                <button type="button" className="fav-remove" aria-label={`${p.name} 즐겨찾기 해제`} onClick={() => onRemovePlace(p)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="myinfo-acts">
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>
      </section>
    </div>
  )
}
