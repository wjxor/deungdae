import os
import sys
import time
from pathlib import Path
from urllib.parse import unquote

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import pandas as pd
from dotenv import load_dotenv

load_dotenv()
SERVICE_KEY = unquote(os.getenv("DATA_GO_KR_KEY", "").strip())
if not SERVICE_KEY:
    sys.exit(".env에 DATA_GO_KR_KEY가 없습니다.")

RAW_DIR = str(Path(__file__).resolve().parent / "raw")  # 어디서 실행해도 data/raw에 저장
os.makedirs(RAW_DIR, exist_ok=True)

# 호출 오류시 재시도
session = requests.Session()
session.mount("https://", HTTPAdapter(max_retries=Retry(
    total=4,                                   
    backoff_factor=2,                         
    status_forcelist=[429, 500, 502, 503, 504],  
)))

def get_json(url, params):
    """API를 호출해 JSON을 돌려준다. 오류가 나도 서비스 키가 든 전체 URL은 출력하지 않는다"""
    try:
        r = session.get(url, params=params, timeout=30)
    except requests.RequestException as e:
        sys.exit(f"요청 실패 ({url}): {type(e).__name__}")
    if not r.ok:
        sys.exit(f"HTTP {r.status_code} ({url}): {r.text[:300]}")
    return r.json()


def save_raw(df, name):
    path = f"{RAW_DIR}/{name}.csv"
    df.to_csv(path, index=False, encoding="utf-8-sig")
    print(f"  저장: {path} ({len(df):,}건, 컬럼 {len(df.columns)}개)")

#---수집---

def collect_security_light():
    print("\n[보안등]")
    url = "https://apis.data.go.kr/6300000/GetScltListService1/getScltList1"
    rows, page = [], 1
    while True:
        data = get_json(url, {
            "serviceKey": SERVICE_KEY,
            "pageNo": page,
            "numOfRows": 1000,
            "type": "json",
        })
        body = data["response"]["body"]
        total = int(body["totalCount"])

        items = body.get("items") or []
        if isinstance(items, dict):          
            items = items.get("item", [])
        if isinstance(items, dict):         
            items = [items]

        rows.extend(items)
        print(f"  page {page}: {len(rows):,} / {total:,}")
        if not items or len(rows) >= total:
            break
        page += 1
        time.sleep(0.3)

    df = pd.DataFrame(rows)
    save_raw(df, "security_light")


def collect_cctv():
    print("\n[방범 CCTV]")
    url = "https://apis.data.go.kr/6300000/openapi2022/safeCCTV/getsafeCCTV"
    rows, page = [], 1
    while True:
        data = get_json(url, {
            "serviceKey": SERVICE_KEY,
            "pageNo": page,
            "numOfRows": 1000,
        })
        body = data["response"]["body"]
        total = int(body["totalCount"])
        items = body.get("items") or []    

        rows.extend(items)
        print(f"  page {page}: {len(rows):,} / {total:,}")
        if not items or len(rows) >= total:
            break
        page += 1
        time.sleep(0.3)

    df = pd.DataFrame(rows)
    save_raw(df, "cctv")

def collect_street_light():
    print("\n[가로등]")
    url = "https://api.odcloud.kr/api/15110054/v1/uddi:283207b1-f595-4c46-bbd5-838abeb18429"
    rows, page = [], 1
    while True:
        data = get_json(url, {
            "serviceKey": SERVICE_KEY,
            "page": page,
            "perPage": 1000,
            "returnType": "JSON",
        })
        total = int(data["totalCount"])
        items = data.get("data") or []

        rows.extend(items)
        print(f"  page {page}: {len(rows):,} / {total:,}")
        if not items or len(rows) >= total:
            break
        page += 1
        time.sleep(0.3)

    df = pd.DataFrame(rows)
    save_raw(df, "street_light")

BELL_CODES = {
    "3640000": "동구",
    "3650000": "중구",
    "3660000": "서구",
    "3670000": "유성구",
    "3680000": "대덕구",
}


def collect_emergency_bell():
    print("\n[안전비상벨]")
    url = "https://apis.data.go.kr/1741000/emergency_call_box_info/info"
    all_rows = []

    for code, gu in BELL_CODES.items():
        rows, page = [], 1
        while True:
            data = get_json(url, {
                "serviceKey": SERVICE_KEY,
                "pageNo": page,
                "numOfRows": 100,
                "returnType": "json",
                "cond[OPN_ATMY_GRP_CD::EQ]": code,
            })
            body = data["response"]["body"]
            total = int(body["totalCount"])
            if total == 0:
                break

            items = body["items"]["item"]
            if isinstance(items, dict):
                items = [items]
            rows.extend(items)
            if not items or len(rows) >= total:
                break
            page += 1
            time.sleep(0.3)

        print(f"  {code} ({gu}): {len(rows):,} / {total:,}")
        all_rows.extend(rows)

    if not all_rows:
        print("0건 수집")
        return

    df = pd.DataFrame(all_rows)
    save_raw(df, "emergency_bell")

def collect_police():
    print("\n[지구대·파출소]")
    url = "https://api.odcloud.kr/api/15077036/v1/uddi:6b371c66-09a5-4efd-8445-bfd53672542e"
    rows, page = [], 1
    while True:
        data = get_json(url, {
            "serviceKey": SERVICE_KEY,
            "page": page,
            "perPage": 1000,
            "returnType": "JSON",
        })
        total = int(data["totalCount"])
        items = data.get("data") or []
        rows.extend(items)
        print(f"  page {page}: {len(rows):,} / {total:,} (전국)")
        if not items or len(rows) >= total:
            break
        page += 1
        time.sleep(0.3)

    df = pd.DataFrame(rows)
    dj = df[df["시도청"] == "대전청"]
    print(f"  대전청: {len(dj)}건")
    if dj.empty:
        return

    save_raw(dj, "police")

COLLECTORS = {
    "security_light": collect_security_light,
    "cctv": collect_cctv,
    "street_light": collect_street_light,
    "emergency_bell": collect_emergency_bell,
    "police": collect_police,
}

if __name__ == "__main__":
    names = sys.argv[1:] or list(COLLECTORS)
    for n in names:
        if n not in COLLECTORS:
            sys.exit(f"알 수 없는 이름: {n} / 가능한 이름: {list(COLLECTORS)}")
    for n in names:
        COLLECTORS[n]()
    print("\n완료")