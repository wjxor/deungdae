const JS_KEY = import.meta.env.VITE_KAKAO_JS_KEY as string | undefined

let loading: Promise<typeof kakao> | null = null

// 카카오맵 JavaScript SDK를 한 번만 불러온다. 지도 SDK용 JavaScript 키만 쓴다 (REST 키 금지)
export function loadKakaoMaps(): Promise<typeof kakao> {
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    if (!JS_KEY) {
      reject(new Error('VITE_KAKAO_JS_KEY가 설정되지 않았습니다. 루트 .env를 확인해 주세요.'))
      return
    }
    const script = document.createElement('script')
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${JS_KEY}&autoload=false`
    script.onload = () => kakao.maps.load(() => resolve(kakao))
    script.onerror = () =>
      reject(new Error('카카오맵을 불러오지 못했습니다. 키와 사이트 도메인(http://localhost:5173) 등록을 확인해 주세요.'))
    document.head.appendChild(script)
  })
  loading.catch(() => {
    loading = null
  })
  return loading
}
