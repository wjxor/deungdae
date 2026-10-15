import type { FacilityType } from '../../../../shared/types'

// 안전시설 아이콘 (B 세트: 선 그림 배지). 색만이 아니라 그림으로도 구분한다.
const ICONS: Record<FacilityType, { label: string; color: string; path: string }> = {
  cctv: {
    label: '방범용 CCTV',
    color: '#2f5f8a',
    path: '<rect x="2.5" y="7.5" width="13" height="8" rx="2"/><path d="M15.5 11l6-3v8l-6-3"/><path d="M7 15.5V19M4.5 19h5"/>',
  },
  emergency_bell: {
    label: '안심벨',
    color: '#b24a42',
    path: '<path d="M6 16v-5a6 6 0 0112 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 004 0"/>',
  },
  police: {
    label: '지구대·파출소',
    color: '#2f7a55',
    path: '<path d="M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z"/><path d="M12 8l1.2 2.4 2.6.4-1.9 1.8.5 2.6L12 14l-2.4 1.2.5-2.6-1.9-1.8 2.6-.4z"/>',
  },
}

export function createFacilityIcon(type: FacilityType): HTMLElement {
  const { label, color, path } = ICONS[type]
  const el = document.createElement('div')
  el.className = 'facility-marker'
  el.style.borderColor = color
  el.title = label
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', label)
  // path는 위에 적힌 고정 문자열이다. 사용자 입력이 들어가지 않는다
  el.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
  return el
}
