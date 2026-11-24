"""수집 원본(data/raw/*.csv)을 ERD의 facilities 형식 CSV로 정제한다.

실행 (레포 루트에서):
    python data/clean_facilities.py              # 결과는 data/processed/ 에 저장
    python data/clean_facilities.py <출력 폴더>

입력
- data/raw/*.csv              collect_raw_data.py 가 받은 원본 (커밋 안 함)
- data/bell_final_coords.csv  안심벨 최종 좌표 (검증 후 손으로 정한 값이라 커밋함)
- data/police_coords.csv      지구대·파출소 좌표 (API에 좌표가 없어 지도 사이트에서 구한 값, 커밋함)
- data/validation/address_mismatch.csv  상협 검증 목록 (CCTV 경도 보정 및 오차 행 제외 대상)

출력 열: type, source_key, name, address, district, lat, lng, coord_source, attributes
- id, created_at, location 은 DB가 만들고, data_source_id 는 적재할 때 붙인다
- 관리번호처럼 긴 숫자는 문자열로 읽는다 (엑셀로 열고 저장하면 뒷자리가 깨지니 엑셀로 저장하지 말 것)
"""
import json
import re
import sys
from pathlib import Path

import pandas as pd

BASE = Path(__file__).resolve().parent
RAW_DIR = BASE / "raw"
BELL_COORDS = BASE / "bell_final_coords.csv"
POLICE_COORDS = BASE / "police_coords.csv"
MISMATCH = BASE / "validation" / "address_mismatch.csv"

GUS = ("동구", "중구", "서구", "유성구", "대덕구")
BELL_GU = {"3640000": "동구", "3650000": "중구", "3660000": "서구", "3670000": "유성구", "3680000": "대덕구"}
# 비상벨 최종 좌표 출처 -> ERD coord_source
COORD_SOURCE = {"원본": "original", "도로명 변환": "geocoded", "지번 변환": "geocoded", "직접 설정": "corrected"}
COLUMNS = ["type", "source_key", "name", "address", "district", "lat", "lng", "coord_source", "attributes"]

# 대전 대략 범위 (validation/common.py의 DAEJEON_BBOX와 같음): 위도 최소·최대, 경도 최소·최대
DAEJEON_BBOX = (36.18, 36.51, 127.24, 127.57)

# 원본 주소에 있는 오타 (보안등 "유성궁 봉산동", CCTV "중수 산성동")
ADDR_TYPO = {"유성궁": "유성구", "중수": "중구"}

# CCTV 경도가 서쪽으로 1.57km 밀린 행(위도는 그대로)에 더해 주는 값
LNG_SHIFT = 0.0175
# 검증 목록 비고가 "0.0175° 서쪽 밀림"이어도 원본 위치가 맞아서 경도 보정에서 빼는 행
LNG_SHIFT_EXCLUDE = {"038.(2012-47) 판암초 주변"}
# CCTV 위도 오타 보정
CCTV_LAT_FIX = {"030-1.(200-2011-24) 정림동성당근처(고정)": ("030.(200-2011-24) 정림동성당근처", 36.30749673)}


def load_csv(name):
    """관리번호 같은 긴 숫자가 바뀌지 않게 전부 문자열로 읽는다"""
    return pd.read_csv(RAW_DIR / f"{name}.csv", dtype=str, keep_default_na=False,
                       encoding="utf-8-sig").to_dict("records")


def load_mismatch():
    return pd.read_csv(MISMATCH, encoding="utf-8-sig", dtype=str).fillna("")


def gu_of(text):
    text = text or ""
    for wrong, right in ADDR_TYPO.items():
        text = text.replace(wrong, right)
    m = re.search("|".join(GUS), text)
    return m.group(0) if m else None


def blank(v):
    """빈 문자열은 None으로"""
    return None if v is None or (isinstance(v, str) and not v.strip()) else v


def num(v):
    v = blank(v)
    return None if v is None else float(v)


def attrs(**kw):
    return json.dumps(kw, ensure_ascii=False)


def street_light(raw):
    return [{
        "type": "street_light", "source_key": r["관리번호"], "name": None, "address": None,
        "district": gu_of(r["행정읍면동"]), "lat": num(r["위도"]), "lng": num(r["경도"]),
        "coord_source": "original", "attributes": attrs(fixture_count=int(r["등기구수량"])),
    } for r in raw]


def security_light(raw):
    rows = []
    for r in raw:
        addr = blank(r["RDNMADR"]) or blank(r["LNMADR"])
        rows.append({
            "type": "security_light", "source_key": None, "name": blank(r["LMP_LC_NM"]), "address": addr,
            "district": gu_of(addr), "lat": num(r["LATITUDE"]), "lng": num(r["LONGITUDE"]),
            "coord_source": "original",
            # INSTALLATION_CO(설치 개수)는 lamp_count로 반드시 보관
            "attributes": attrs(lamp_count=int(r["INSTALLATION_CO"]), install_type=blank(r["INSTALLATION_TYPE"])),
        })
    return rows


def _pick_coord(row, candidates):
    for col in candidates:
        if col in row and blank(row[col]) is not None:
            return num(row[col])
    return None


def filter_security_light_mismatch(rows, mismatch_df=None):
    """address_mismatch.csv의 보안등 항목을 (위치명, 원본 위도, 원본 경도)로 맞춰 제외한다."""
    m = mismatch_df if mismatch_df is not None else load_mismatch()
    sub = m[m["dataset"].str.contains("보안등|security_light", case=False, na=False)]
    targets = set()
    for _, row in sub.iterrows():
        name = blank(row.get("id", "") or row.get("name", ""))
        lat = _pick_coord(row, ["lat", "orig_lat", "raw_lat", "y", "위도"])
        lng = _pick_coord(row, ["lng", "lon", "orig_lng", "raw_lng", "x", "경도"])
        if name is not None and lat is not None and lng is not None:
            targets.add((name.strip(), round(lat, 6), round(lng, 6)))

    kept, dropped = [], 0
    for r in rows:
        key = (
            r["name"].strip() if r["name"] is not None else None,
            round(r["lat"], 6) if r["lat"] is not None else None,
            round(r["lng"], 6) if r["lng"] is not None else None,
        )
        if key in targets:
            dropped += 1
        else:
            kept.append(r)
    print(f"  보안등 주소 불일치 제외(위치명+원본좌표): {dropped:,}건 (목록 {len(sub):,}건)")
    return kept


def cctv(raw):
    rows = []
    for r in raw:
        addr = blank(r["rdnmadr"]) or blank(r["lnmAdres"])
        rows.append({
            "type": "cctv", "source_key": blank(r["manageNo"]), "name": None, "address": addr,
            "district": gu_of(addr), "lat": num(r["crdntY"]), "lng": num(r["crdntX"]),
            "coord_source": "original",
            "attributes": attrs(cctv_type=blank(r["cctvTy"]), manager=blank(r["mgcNm"])),
        })
    return rows


def fix_cctv(rows, mismatch_df=None):
    """CCTV 보정과 중복 제거"""
    m = mismatch_df if mismatch_df is not None else load_mismatch()
    listed = set(m[(m["dataset"] == "CCTV") & m["note"].str.contains("0.0175", na=False)]["id"])
    assert LNG_SHIFT_EXCLUDE <= listed, "제외한 행이 검증 목록에 없음"
    shifted = listed - LNG_SHIFT_EXCLUDE
    by_key = {r["source_key"]: r for r in rows}
    out, seen, n_dup, n_shift, n_lat = [], set(), 0, 0, 0
    for r in rows:
        key = (r["source_key"], r["lat"], r["lng"])
        if key in seen:
            n_dup += 1
            continue
        seen.add(key)
        r = dict(r)
        if r["source_key"] in CCTV_LAT_FIX:
            pair, lat = CCTV_LAT_FIX[r["source_key"]]
            p = by_key[pair]
            assert p["address"] == r["address"] and p["lng"] == r["lng"] and p["lat"] == lat, "위도 오타 보정 근거가 바뀜"
            r["lat"], r["coord_source"] = lat, "corrected"
            n_lat += 1
        if r["source_key"] in shifted:
            r["lng"], r["coord_source"] = round(r["lng"] + LNG_SHIFT, 8), "corrected"
            n_shift += 1
        out.append(r)
    assert n_shift == len(shifted), f"보정 대상 {len(shifted)}건 중 {n_shift}건만 찾음"
    print(f"  CCTV 중복 제거 {n_dup}, 경도 +{LNG_SHIFT} 보정 {n_shift}(목록 {len(listed)}행 중 {len(LNG_SHIFT_EXCLUDE)}행 제외), 위도 오타 보정 {n_lat}")
    return out


def filter_cctv_mismatch(rows, mismatch_df=None):
    """address_mismatch.csv의 CCTV 목록 중 이미 보정(coord_source == 'corrected')된 행을 뺀 나머지를 제외한다."""
    m = mismatch_df if mismatch_df is not None else load_mismatch()
    cctv_mismatch_ids = set(m[m["dataset"] == "CCTV"]["id"])
    corrected_ids = {r["source_key"] for r in rows if r["coord_source"] == "corrected"}
    drop_ids = cctv_mismatch_ids - corrected_ids

    kept, dropped = [], 0
    for r in rows:
        if r["source_key"] in drop_ids:
            dropped += 1
        else:
            kept.append(r)
    print(f"  CCTV 주소 불일치 제외: {dropped:,}건 (목록 {len(cctv_mismatch_ids):,}건 중 보정 {len(cctv_mismatch_ids & corrected_ids):,}건 제외)")
    return kept


def emergency_bell(raw):
    final = pd.read_csv(BELL_COORDS, dtype=str, encoding="utf-8-sig").set_index("관리번호")
    rows = []
    check_values = []
    for r in raw:
        f = final.loc[r["MNG_NO"]]
        year = blank(r["SFTY_EMRGNCBLL_INSTL_YR"])
        last_check = blank(r["LAST_CHCK_RSLT_SE"])
        check_values.append(last_check)
        rows.append({
            "type": "emergency_bell", "source_key": r["MNG_NO"], "name": blank(r["INSTL_PSTN"]),
            "address": blank(r["LCTN_ROAD_NM_ADDR"]) or blank(r["LCTN_LOTNO_ADDR"]),
            "district": BELL_GU[r["OPN_ATMY_GRP_CD"]], "lat": float(f["최종_위도"]), "lng": float(f["최종_경도"]),
            "coord_source": COORD_SOURCE[f["최종_좌표_출처"]],
            "attributes": attrs(
                place_type=blank(r["INSTL_PLC_TYPE"]), last_check=last_check,
                installed_year=int(year) if year else None, police_link=blank(r["POLC_LINK_EN"])),
        })
    counts = pd.Series(check_values, dtype="object").fillna("(없음)").value_counts().to_dict()
    print(f"  비상벨 last_check 분포: {counts}")
    return rows


def filter_bad_emergency_bell(rows):
    """비상벨 속성 last_check가 'N'(불량)인 행을 걸러내고 건수를 출력한다."""
    kept, dropped = [], 0
    for r in rows:
        attr_dict = json.loads(r["attributes"])
        if attr_dict.get("last_check") in {"N", "불량"}:
            dropped += 1
        else:
            kept.append(r)
    print(f"  비상벨 점검 불량('N') 제외: {dropped:,}건")
    return kept


def police(raw):
    """좌표는 API에 없어서 지도 사이트에서 구한 값(police_coords.csv)을 관서명으로 붙인다."""
    co = pd.read_csv(POLICE_COORDS, dtype=str, encoding="utf-8-sig").set_index("관서명")
    names = [r["관서명"] for r in raw]
    assert len(set(names)) == len(names), "관서명이 겹침"
    assert set(names) == set(co.index), f"좌표 파일과 관서명이 다름: {set(names) ^ set(co.index)}"
    rows = []
    for r in raw:
        addr = re.sub(r"\s+", " ", r["주소"]).strip()
        c = co.loc[r["관서명"]]
        rows.append({
            "type": "police", "source_key": r["관서명"], "name": r["관서명"], "address": addr,
            "district": gu_of(addr), "lat": float(c["lat"]), "lng": float(c["lng"]),
            "coord_source": "geocoded",
            "attributes": attrs(kind=blank(r["구분"]), police_station=blank(r["경찰서"])),
        })
    return rows


def in_daejeon(r):
    lat_min, lat_max, lng_min, lng_max = DAEJEON_BBOX
    return r["lat"] is not None and r["lng"] is not None and lat_min <= r["lat"] <= lat_max and lng_min <= r["lng"] <= lng_max


def save(rows, out_dir, name):
    """좌표가 없거나 대전 밖인 행은 빼고 건수를 출력한 뒤 저장한다"""
    kept = [r for r in rows if in_daejeon(r)]
    dropped = [r for r in rows if not in_daejeon(r)]
    for r in dropped:
        print(f"  제외(좌표 없음·대전 밖): {r['source_key'] or r['name']} lat={r['lat']} lng={r['lng']}")
    df = pd.DataFrame(kept, columns=COLUMNS)
    assert df["district"].notna().all(), "district가 빈 행이 있음"
    path = Path(out_dir) / f"{name}.csv"
    df.to_csv(path, index=False, encoding="utf-8-sig")
    corrected = int((df["coord_source"] == "corrected").sum())
    print(f"저장: {path} (입력 {len(rows):,}건, 저장 {len(df):,}건, 제외 {len(dropped)}건, 좌표 보정 {corrected}건)")
    return df


if __name__ == "__main__":
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE / "processed"
    out_dir.mkdir(parents=True, exist_ok=True)
    mismatch_df = load_mismatch()

    save(street_light(load_csv("street_light")), out_dir, "facilities_street_light")
    save(filter_security_light_mismatch(security_light(load_csv("security_light")), mismatch_df),
         out_dir, "facilities_security_light")
    save(filter_cctv_mismatch(fix_cctv(cctv(load_csv("cctv")), mismatch_df), mismatch_df),
         out_dir, "facilities_cctv")
    save(filter_bad_emergency_bell(emergency_bell(load_csv("emergency_bell"))),
         out_dir, "facilities_emergency_bell")
    save(police(load_csv("police")), out_dir, "facilities_police")