"""data/processed/facilities_*.csv 를 DB(facilities 테이블)에 적재한다.

기본은 점검만 한다(DB에 아무것도 쓰지 않음). 실제 적재는 --commit 을 붙여야 한다.

  python data/load_facilities.py            # 점검만 (DB 연결도 안 함)
  python data/load_facilities.py --check-db # DB 연결해서 현재 상태만 읽어 봄
  python data/load_facilities.py --commit   # 실제 적재 (상협과 합의 후)

DB 주소는 프로젝트 루트 .env 의 DIRECT_URL (없으면 DATABASE_URL) 을 쓴다.
주소와 비밀번호는 화면에 출력하지 않는다.
필요: pip install "psycopg[binary]" python-dotenv
"""
import argparse
import json
import os
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
PROCESSED = ROOT / "data" / "processed"
DISTRICTS = {"동구", "중구", "서구", "유성구", "대덕구"}
COORD_SOURCES = {"original", "geocoded", "corrected"}
BBOX = (36.18, 36.51, 127.24, 127.57)  # lat 최소/최대, lng 최소/최대

# type: (원본 건수, 제목, 출처 주소). 원본 건수는 정제 전 입력 건수 (README 정제 결과 표)
# 출처 주소는 공공데이터포털의 데이터 상세 페이지다 (data/README.md 표의 번호와 같음)
SOURCES = {
    "street_light": (43082, "대전광역시 가로등 현황", "https://www.data.go.kr/data/15110054/openapi.do"),
    "security_light": (28579, "대전광역시 보안등 조회", "https://www.data.go.kr/data/15110685/openapi.do"),
    "cctv": (2985, "대전광역시 방범용 CCTV", "https://www.data.go.kr/data/15109459/openapi.do"),
    "emergency_bell": (575, "행정안전부 안전비상벨 위치정보", "https://www.data.go.kr/data/15149530/openapi.do"),
    "police": (31, "경찰청 전국 지구대·파출소 주소", "https://www.data.go.kr/data/15077036/openapi.do"),
}
BASE_DATE = "2026-09-30"
ATTR_KEYS = {
    "emergency_bell": {"place_type", "last_check", "installed_year", "police_link"},
    "cctv": {"cctv_type", "manager"},
    "security_light": {"lamp_count", "install_type"},
    "street_light": {"fixture_count"},
    "police": {"kind", "police_station"},
}
COLS = ["type", "source_key", "name", "address", "district", "lat", "lng", "coord_source", "attributes"]


def load_and_validate():
    """CSV를 읽고 규칙을 어기면 바로 멈춘다. {type: DataFrame} 반환."""
    out = {}
    for t in SOURCES:
        path = PROCESSED / f"facilities_{t}.csv"
        if not path.exists():
            sys.exit(f"파일 없음: {path}")
        df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
        if list(df.columns) != COLS:
            sys.exit(f"{t}: 컬럼이 다름 {list(df.columns)}")
        if set(df["type"]) != {t}:
            sys.exit(f"{t}: type 값이 섞여 있음 {set(df['type'])}")
        bad = set(df["district"]) - DISTRICTS - {""}
        if bad:
            sys.exit(f"{t}: district 값이 이상함 {bad}")
        bad = set(df["coord_source"]) - COORD_SOURCES
        if bad:
            sys.exit(f"{t}: coord_source 값이 이상함 {bad}")
        lat = pd.to_numeric(df["lat"], errors="raise")
        lng = pd.to_numeric(df["lng"], errors="raise")
        if not (lat.between(BBOX[0], BBOX[1]).all() and lng.between(BBOX[2], BBOX[3]).all()):
            sys.exit(f"{t}: 대전 범위 밖 좌표가 있음")
        for i, s in enumerate(df["attributes"]):
            d = json.loads(s)
            if not set(d) <= ATTR_KEYS[t]:
                sys.exit(f"{t}: attributes 키가 이상함 (행 {i}) {set(d) - ATTR_KEYS[t]}")
        out[t] = df
        print(f"점검 통과: {t} {len(df):,}건 (원본 {SOURCES[t][0]:,}건)")
    return out


def connect():
    try:
        import psycopg
        from dotenv import load_dotenv
    except ImportError:
        sys.exit('먼저 설치: pip install "psycopg[binary]" python-dotenv')
    load_dotenv(ROOT / ".env")
    url = os.environ.get("DIRECT_URL") or os.environ.get("DATABASE_URL")
    if not url:
        sys.exit(".env 에 DIRECT_URL 이 없음")
    # Prisma 전용 옵션(?schema=..., pgbouncer=true 등)은 libpq가 못 읽어서 뗀다
    url = url.split("?")[0]
    try:
        return psycopg.connect(url, connect_timeout=15)
    except Exception as e:
        sys.exit(f"DB 연결 실패 ({type(e).__name__}). 주소는 출력하지 않음. .env 를 확인")


def check_db():
    with connect() as conn:
        n = conn.execute("SELECT count(*) FROM facilities").fetchone()[0]
        m = conn.execute("SELECT count(*) FROM data_sources").fetchone()[0]
        p = conn.execute("SELECT postgis_version()").fetchone()[0]
    print(f"DB 연결 OK. facilities {n}건, data_sources {m}건, PostGIS {p}")


def commit(data):
    with connect() as conn:  # with 블록이 정상 종료되면 commit, 에러면 rollback (전부 취소)
        if conn.execute("SELECT count(*) FROM facilities").fetchone()[0] != 0:
            sys.exit("facilities 에 이미 데이터가 있음. 중복 적재 방지를 위해 멈춤")
        if conn.execute("SELECT count(*) FROM data_sources").fetchone()[0] != 0:
            sys.exit("data_sources 에 이미 데이터가 있음. 멈춤")
        cur = conn.cursor()
        for t, df in data.items():
            raw, title, url = SOURCES[t]
            ds_id = cur.execute(
                "INSERT INTO data_sources (facility_type, title, source_url, base_date, raw_count, loaded_count)"
                " VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (t, title, url, BASE_DATE, raw, len(df)),
            ).fetchone()[0]
            cur.execute(
                "CREATE TEMP TABLE stg (source_key text, name text, address text, district text,"
                " lat float8, lng float8, coord_source text, attributes text) ON COMMIT DROP"
            )
            with cur.copy("COPY stg FROM STDIN") as cp:
                for r in df.itertuples(index=False):
                    cp.write_row([
                        r.source_key or None, r.name or None, r.address or None,
                        r.district or None, float(r.lat), float(r.lng),
                        r.coord_source, r.attributes,
                    ])
            cur.execute(
                "INSERT INTO facilities (type, data_source_id, source_key, name, address, district,"
                " location, coord_source, attributes)"
                " SELECT %s, %s, source_key, name, address, district,"
                " ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,"  # 경도(lng)가 먼저
                " coord_source, attributes::jsonb FROM stg",
                (t, ds_id),
            )
            cur.execute("DROP TABLE stg")
            got = cur.execute("SELECT count(*) FROM facilities WHERE type = %s", (t,)).fetchone()[0]
            if got != len(df):
                raise RuntimeError(f"{t}: 넣은 건수 {got} != CSV {len(df)}  (전부 취소됨)")
            print(f"적재: {t} {got:,}건")
        # 좌표 방향 확인: 모든 점이 대전 범위 안이어야 함 (lat/lng 뒤집히면 여기서 걸림)
        bad = cur.execute(
            "SELECT count(*) FROM facilities WHERE NOT (ST_Y(location::geometry) BETWEEN %s AND %s"
            " AND ST_X(location::geometry) BETWEEN %s AND %s)", BBOX,
        ).fetchone()[0]
        if bad:
            raise RuntimeError(f"대전 밖 좌표 {bad}건 (lat/lng 순서 확인). 전부 취소됨")
    print("완료. DBeaver에서 건수를 확인하세요.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--check-db", action="store_true")
    ap.add_argument("--commit", action="store_true")
    a = ap.parse_args()
    data = load_and_validate()
    if a.check_db:
        check_db()
    elif a.commit:
        commit(data)
    else:
        print("점검만 했습니다. DB에는 아무것도 쓰지 않았습니다.")
