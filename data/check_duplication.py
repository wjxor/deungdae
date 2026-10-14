import os
from pathlib import Path

import pandas as pd

RAW_DIR = str(Path(__file__).resolve().parent / "raw")  # 어디서 실행해도 data/raw를 본다

# 파일명: (식별 필드, 위도 필드, 경도 필드)
TARGETS = {
    "security_light": ("LMP_LC_NM", "LATITUDE", "LONGITUDE"),
    "cctv":           ("manageNo", "crdntY", "crdntX"),
    "street_light":   ("관리번호", "위도", "경도"),
    "emergency_bell": ("MNG_NO", "WGS84_LAT", "WGS84_LOT"),
    "police":         ("관서명", None, None),
}


def check(name, id_col, lat_col, lon_col):
    path = f"{RAW_DIR}/{name}.csv"
    print(f"\n[{name}]")
    if not os.path.exists(path):
        print(f"  파일 없음: {path}")
        return

    df = pd.read_csv(path, dtype=str, encoding="utf-8-sig")
    print(f"  전체 건수      : {len(df):,}")
    print(f"  완전 중복      : {df.duplicated().sum():,}")
    print(f"  ID({id_col}) 중복 : {df.duplicated(subset=[id_col]).sum():,}")

    if lat_col:
        dup = df.duplicated(subset=[lat_col, lon_col])
        spots = df[df.duplicated(subset=[lat_col, lon_col], keep=False)]
        n_spots = spots.groupby([lat_col, lon_col]).ngroups
        print(f"  같은 좌표 중복 : {dup.sum():,}건 ({n_spots:,}개 지점)")


if __name__ == "__main__":
    for name, cols in TARGETS.items():
        check(name, *cols)