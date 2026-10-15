"""수집 원본(JSON)을 ERD의 facilities 형식 CSV로 정제한다.

실행 예:
    python data/clean_facilities.py <raw_data 폴더> <bell_final.xlsx> <출력 폴더> [address_mismatch.csv]

출력 열: type, source_key, name, address, district, lat, lng, coord_source, attributes
- id, created_at, location 은 DB가 만든다
- 관리번호처럼 긴 숫자는 문자열로 다룬다 (엑셀로 열고 저장하면 뒷자리가 깨지니 엑셀로 저장하지 말 것)
"""
import json
import re
import sys
from pathlib import Path

import pandas as pd

GUS = ("동구", "중구", "서구", "유성구", "대덕구")
BELL_GU = {"3640000": "동구", "3650000": "중구", "3660000": "서구", "3670000": "유성구", "3680000": "대덕구"}
# 비상벨 최종 좌표 출처(엑셀) -> ERD coord_source
COORD_SOURCE = {"원본": "original", "도로명 변환": "geocoded", "지번 변환": "geocoded", "직접 설정": "corrected"}
COLUMNS = ["type", "source_key", "name", "address", "district", "lat", "lng", "coord_source", "attributes"]


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


# 원본 주소에 있는 오타 (보안등 "유성궁 봉산동", CCTV "중수 산성동")
ADDR_TYPO = {"유성궁": "유성구", "중수": "중구"}


def gu_of(text):
    text = text or ""
    for wrong, right in ADDR_TYPO.items():
        text = text.replace(wrong, right)
    m = re.search("|".join(GUS), text)
    return m.group(0) if m else None


def blank(v):
    """빈 문자열은 None으로"""
    return None if v is None or (isinstance(v, str) and not v.strip()) else v


def attrs(**kw):
    return json.dumps(kw, ensure_ascii=False)


def street_light(raw):
    rows = []
    for r in raw:
        rows.append({
            "type": "street_light", "source_key": str(r["관리번호"]), "name": None, "address": None,
            "district": gu_of(r["행정읍면동"]), "lat": r["위도"], "lng": r["경도"],
            "coord_source": "original", "attributes": attrs(fixture_count=int(r["등기구수량"])),
        })
    return rows


def security_light(raw):
    rows = []
    for r in raw:
        addr = blank(r["RDNMADR"]) or blank(r["LNMADR"])
        rows.append({
            "type": "security_light", "source_key": None, "name": blank(r["LMP_LC_NM"]), "address": addr,
            "district": gu_of(addr), "lat": r["LATITUDE"], "lng": r["LONGITUDE"],
            "coord_source": "original",
            # INSTALLATION_CO(설치 개수)는 lamp_count로 반드시 보관
            "attributes": attrs(lamp_count=int(r["INSTALLATION_CO"]), install_type=blank(r["INSTALLATION_TYPE"])),
        })
    return rows


def cctv(pages):
    items = [it for p in pages for it in p["response"]["body"]["items"]]
    rows = []
    for r in items:
        addr = blank(r["rdnmadr"]) or blank(r["lnmAdres"])
        rows.append({
            "type": "cctv", "source_key": blank(r["manageNo"]), "name": None, "address": addr,
            "district": gu_of(addr), "lat": r["crdntY"], "lng": r["crdntX"],
            "coord_source": "original",
            "attributes": attrs(cctv_type=blank(r["cctvTy"]), manager=blank(r["mgcNm"])),
        })
    return rows


def emergency_bell(raw, final_xlsx):
    final = pd.read_excel(final_xlsx, dtype=str).set_index("관리번호")
    rows = []
    for grp, items in raw.items():
        for r in items:
            f = final.loc[r["MNG_NO"]]  # 관리번호로 최종 좌표를 찾는다
            year = blank(r.get("SFTY_EMRGNCBLL_INSTL_YR"))
            rows.append({
                "type": "emergency_bell", "source_key": str(r["MNG_NO"]), "name": blank(r["INSTL_PSTN"]),
                "address": blank(r["LCTN_ROAD_NM_ADDR"]) or blank(r["LCTN_LOTNO_ADDR"]),
                "district": BELL_GU[grp], "lat": f["최종_위도"], "lng": f["최종_경도"],
                "coord_source": COORD_SOURCE[f["최종_좌표_출처"]],
                "attributes": attrs(
                    place_type=blank(r["INSTL_PLC_TYPE"]), last_check=blank(r["LAST_CHCK_RSLT_SE"]),
                    installed_year=int(year) if year else None, police_link=blank(r["POLC_LINK_EN"])),
            })
    return rows


LNG_SHIFT = 0.0175  # 서구 CCTV 94건: 경도가 서쪽으로 1.57km 밀려 있어 더해 준다


def fix_cctv(rows, mismatch_csv):
    """상협의 검증 목록(address_mismatch.csv)에서 '0.0175° 서쪽 밀림'으로 표시된 서구 CCTV만 경도 보정.
    - 완전히 같은 행(관리번호·좌표 동일)은 하나만 남긴다
    - 대전 범위 밖 좌표(위도 36.55 초과)는 적재에서 뺀다 (data/README.md 규칙)"""
    m = pd.read_csv(mismatch_csv, encoding="utf-8-sig", dtype=str)
    m = m[(m["dataset"] == "CCTV") & (m["gu"] == "서구") & m["note"].fillna("").str.contains("0.0175")]
    ids = set(m["id"])
    out, seen, dropped = [], set(), []
    for r in rows:
        key = (r["source_key"], r["lat"], r["lng"])
        if key in seen:
            dropped.append(("중복", r["source_key"])); continue
        seen.add(key)
        if not (36.15 <= float(r["lat"]) <= 36.55):
            dropped.append(("대전 밖", r["source_key"])); continue
        if r["source_key"] in ids and r["district"] == "서구":
            r = dict(r, lng=round(float(r["lng"]) + LNG_SHIFT, 8), coord_source="corrected")
        out.append(r)
    print(f"CCTV 경도 보정 {sum(r['coord_source'] == 'corrected' for r in out)}건, 제외 {dropped}")
    return out


def police(raw, coords_csv):
    """좌표는 API에 없어서 지도 사이트에서 직접 구한 값(police_coords.csv)을 연번으로 붙인다"""
    co = pd.read_csv(coords_csv, dtype={"연번": str}).set_index("연번")
    rows = []
    for r in raw:
        addr = re.sub(r"\s+", " ", r["주소"]).strip()
        c = co.loc[str(r["연번"])]
        rows.append({
            "type": "police", "source_key": str(r["연번"]), "name": r["관서명"], "address": addr,
            "district": gu_of(addr), "lat": c["lat"], "lng": c["lng"],
            "coord_source": "geocoded",
            "attributes": attrs(kind=blank(r["구분"]), police_station=blank(r["경찰서"])),
        })
    return rows


def save(rows, out_dir, name):
    df = pd.DataFrame(rows, columns=COLUMNS)
    path = Path(out_dir) / f"{name}.csv"
    df.to_csv(path, index=False, encoding="utf-8-sig")
    print(f"저장: {path} ({len(df):,}건)")
    return df


if __name__ == "__main__":
    raw_dir, bell_xlsx, out_dir = sys.argv[1:4]
    raw_dir, out_dir = Path(raw_dir), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    save(street_light(load(raw_dir / "street_light_api_raw.json")), out_dir, "facilities_street_light")
    save(security_light(load(raw_dir / "security_light_api_raw.json")), out_dir, "facilities_security_light")
    save(emergency_bell(load(raw_dir / "bell_api_raw.json"), bell_xlsx), out_dir, "facilities_emergency_bell")
    save(police(load(raw_dir / "police_api_raw.json"), Path(__file__).resolve().parent / "police_coords.csv"),
         out_dir, "facilities_police")
    mismatch = Path(sys.argv[4]) if len(sys.argv) > 4 else None  # data/validation/address_mismatch.csv
    cctv_rows = cctv(load(raw_dir / "cctv_api_raw.json"))
    if mismatch:
        save(fix_cctv(cctv_rows, mismatch), out_dir, "facilities_cctv")
    else:
        save(cctv_rows, out_dir, "facilities_cctv_uncorrected")
