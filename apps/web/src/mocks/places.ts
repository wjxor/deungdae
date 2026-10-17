import type { Place } from '../../../../shared/types'

// 목 데이터. 서버(GET /places)가 생기면 이 파일은 지운다. (API.md 2장)
export const MOCK_PLACES: Place[] = [
  {
    id: 'mock-woosong',
    name: '우송대학교',
    address: '대전광역시 동구 동대전로 171',
    location: { lat: 36.3371, lng: 127.44509 },
  },
]
