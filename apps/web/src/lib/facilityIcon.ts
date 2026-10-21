import type { FacilityType } from '../../../../shared/types'

// 안전시설 마커 (K3: 줌에 따라 점 → 아이콘). 레벨 4 이하에서는 색만이 아니라 그림으로도 구분한다.
// 크기는 CSS가 .map의 data-level로 정한다 (index.css).
export const FACILITY_TYPES: FacilityType[] = ['cctv', 'emergency_bell', 'police']

export const FACILITY_ICONS: Record<FacilityType, { label: string; short: string; path: string }> = {
  cctv: {
    label: '방범용 CCTV',
    short: 'CCTV',
    path: '<path d="M4 16a8 8 0 0116 0z"/><circle cx="12" cy="12.5" r="1.8"/><path d="M3 19.5h18"/>',
  },
  emergency_bell: {
    label: '안심벨',
    short: '안심벨',
    path: '<path d="M6 16v-5a6 6 0 0112 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 004 0"/>',
  },
  police: {
    label: '지구대·파출소',
    short: '지구대',
    path: '<path d="M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z"/><path d="M12 8l1.2 2.4 2.6.4-1.9 1.8.5 2.6L12 14l-2.4 1.2.5-2.6-1.9-1.8 2.6-.4z"/>',
  },
}

export function createFacilityIcon(type: FacilityType): HTMLElement {
  const { label, path } = FACILITY_ICONS[type]
  const el = document.createElement('div')
  // 색은 CSS가 종류와 낮/밤에 따라 정한다 (.facility-marker.cctv 등)
  el.className = `facility-marker ${type}`
  el.title = label
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', label)
  // path는 위에 적힌 고정 문자열이다. 사용자 입력이 들어가지 않는다
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
  return el
}
