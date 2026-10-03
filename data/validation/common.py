"""시설 데이터 검증 스크립트 공용 모듈 — 데이터셋 정의, CSV 읽기, 거리 계산, 카카오 주소 검색(캐시)

표준 라이브러리만 쓴다 (Python 3.9+). 입력은 근영 원본 수집본(`data/raw/*.csv`, 노션 "캡스톤" 3.2의 raw.zip).
"""
from __future__ import annotations

import csv
import json
import logging
import math
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw"
OUT_DIR = Path(__file__).resolve().parent
CACHE_PATH = OUT_DIR / ".cache" / "geocode_cache.json"

DISTRICTS = ["동구", "중구", "서구", "유성구", "대덕구"]
UNKNOWN = "미상"
# 안전비상벨 자치단체코드 (수집 때 대전 필터로 쓴 값)
BELL_DISTRICT_CODES = {"3640000": "동구", "3650000": "중구", "3660000": "서구", "3670000": "유성구", "3680000": "대덕구"}
# 대전 대략 범위: 위도 최소·최대, 경도 최소·최대
DAEJEON_BBOX = (36.18, 36.51, 127.24, 127.57)

# 원본 CSV 컬럼 — 구는 district 컬럼들에서 앞에서부터 찾는다
DATASETS = {
    "emergency_bell": {"label": "비상벨", "id": "MNG_NO", "lat": "WGS84_LAT", "lon": "WGS84_LOT",
                       "address": ["LCTN_ROAD_NM_ADDR", "LCTN_LOTNO_ADDR"], "district": []},
    "cctv": {"label": "CCTV", "id": "manageNo", "lat": "crdntY", "lon": "crdntX",
             "address": ["rdnmadr", "lnmAdres"], "district": ["rdnmadr", "lnmAdres", "mgcNm"]},
    "security_light": {"label": "보안등", "id": "LMP_LC_NM", "lat": "LATITUDE", "lon": "LONGITUDE",
                       "address": ["RDNMADR", "LNMADR"], "district": ["RDNMADR", "LNMADR"]},
    "street_light": {"label": "가로등", "id": "관리번호", "lat": "위도", "lon": "경도",
                     "address": [], "district": ["행정읍면동"]},
}

DIGIT = re.compile(r"\d")
DISTRICT_PATTERN = re.compile(r"(동구|중구|서구|유성구|대덕구)")

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("validation")


def load_rows(name: str, directory: Path = RAW_DIR) -> list[dict]:
    """데이터셋 CSV를 읽어 행 목록으로 돌려준다"""
    path = directory / f"{name}.csv"
    if not path.exists():
        raise SystemExit(f"{path} 가 없습니다. 노션 raw.zip을 data/raw/에 풀어 주세요 (README 참고)")
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def coord(row: dict, name: str) -> tuple[float, float] | None:
    """행의 (위도, 경도). 값이 비어 있으면 None"""
    ds = DATASETS[name]
    lat, lon = (row.get(ds["lat"]) or "").strip(), (row.get(ds["lon"]) or "").strip()
    return (float(lat), float(lon)) if lat and lon else None


def decimals(value: str) -> int:
    """소수점 아래 자릿수. 끝자리 0은 표기 차이라 세지 않는다 (36.3340 → 3)"""
    value = value.strip()
    return len(value.split(".")[1].rstrip("0")) if "." in value else 0


def district_of(row: dict, name: str) -> str:
    """행이 속한 구. 비상벨은 자치단체코드, 나머지는 주소·기관명 컬럼에서 찾는다"""
    if name == "emergency_bell":
        return BELL_DISTRICT_CODES.get(row.get("OPN_ATMY_GRP_CD", ""), UNKNOWN)
    for col in DATASETS[name]["district"]:
        m = DISTRICT_PATTERN.search(row.get(col) or "")
        if m:
            return m.group(1)
    return UNKNOWN


def in_daejeon(point: tuple[float, float]) -> bool:
    """대전 대략 범위 안인지"""
    lat_min, lat_max, lon_min, lon_max = DAEJEON_BBOX
    return lat_min <= point[0] <= lat_max and lon_min <= point[1] <= lon_max


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """두 좌표 사이 거리(m) — 하버사인"""
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def usable_addresses(row: dict, name: str) -> list[str]:
    """번지가 있는 주소만 (번지 없는 동 단위 주소는 동 중심점으로 검색돼 판정에서 뺀다)"""
    addrs = [(row.get(c) or "").strip() for c in DATASETS[name]["address"]]
    return [a for a in addrs if a and DIGIT.search(a.split("(")[0])]


def to_query(address: str) -> str:
    """주소 검색어 — 시 이름이 없으면 '대전'을 붙인다"""
    return address if "대전" in address else "대전 " + address


class Geocoder:
    """카카오 주소 검색 + 로컬 캐시(.cache/, 커밋 안 함). 같은 주소는 한 번만 호출한다"""

    def __init__(self) -> None:
        self.cache = json.loads(CACHE_PATH.read_text()) if CACHE_PATH.exists() else {}

    def get(self, query: str) -> list[float] | None:
        """캐시된 (위도, 경도). 검색 결과가 없던 주소는 None"""
        return self.cache.get(query)

    def fetch_all(self, queries: set[str], label: str) -> None:
        """캐시에 없는 주소만 호출한다 (동시 6개, 1,000건마다 캐시 저장)"""
        todo = sorted(q for q in queries if q not in self.cache)
        log.info(f"{label}: 주소 {len(queries):,}개 중 새로 호출 {len(todo):,}개")
        if not todo:
            return
        key = os.environ.get("KAKAO_REST_API_KEY", "").strip()
        if not key:
            raise SystemExit("KAKAO_REST_API_KEY 환경변수가 없습니다 (README 실행 방법 참고)")
        CACHE_PATH.parent.mkdir(exist_ok=True)
        with ThreadPoolExecutor(max_workers=6) as pool:
            for i in range(0, len(todo), 1000):
                chunk = todo[i:i + 1000]
                for q, result in zip(chunk, pool.map(lambda q: self._call(q, key), chunk)):
                    self.cache[q] = result
                CACHE_PATH.write_text(json.dumps(self.cache, ensure_ascii=False))
                log.info(f"  {min(i + 1000, len(todo)):,}/{len(todo):,}")

    @staticmethod
    def _call(query: str, key: str) -> list[float] | None:
        """주소 검색 1건. 429·5xx·시간 초과는 잠깐 쉬고 다시 시도한다"""
        url = "https://dapi.kakao.com/v2/local/search/address.json?" + urllib.parse.urlencode({"query": query})
        req = urllib.request.Request(url, headers={"Authorization": f"KakaoAK {key}"})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=10) as res:
                    docs = json.load(res)["documents"]
                return [float(docs[0]["y"]), float(docs[0]["x"])] if docs else None
            except urllib.error.HTTPError as e:
                if e.code == 429 or e.code >= 500:
                    time.sleep(2 ** attempt)
                    continue
                raise
            # Python 3.9에선 socket.timeout이 TimeoutError의 하위 클래스가 아니라 따로 잡는다
            except (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError):
                time.sleep(2 ** attempt)
        raise RuntimeError(f"주소 검색 반복 실패: {query}")


def write_csv(path: Path, rows: list[dict], fields: list[str]) -> None:
    """결과 목록을 CSV로 저장한다 (엑셀에서 한글이 깨지지 않게 BOM 포함)"""
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    log.info(f"저장: {path.relative_to(ROOT)} ({len(rows):,}행)")
