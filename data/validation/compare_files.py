"""원본 ↔ 가공본 CSV 비교 — 행을 ID로 맞춘 뒤 빠진 행과 좌표 값이 바뀐 행을 찾는다

예) 조원에게 받은 가공본(좌표 컬럼이 lat·lon으로 바뀐 파일)이 원본(data/raw/)과 같은지 확인
    python3 data/validation/compare_files.py --other ~/Downloads
가공본의 좌표 컬럼은 원본 컬럼명이 있으면 그것을, 없으면 lat·lon을 쓴다. 결과는 출력만 한다.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from pathlib import Path

from common import DATASETS, RAW_DIR, decimals, load_rows, log

# 행을 맞출 키 — ID가 겹치는 데이터는 주소 등을 함께 쓴다
KEYS = {
    "emergency_bell": ["MNG_NO"],
    "cctv": ["manageNo", "lnmAdres", "rdnmadr"],
    "security_light": ["LMP_LC_NM", "RDNMADR", "LNMADR", "REFERENCEDATE"],
    "street_light": ["관리번호"],
}


def compare(name: str, base_dir: Path, other_dir: Path) -> None:
    """한 데이터셋의 원본·가공본을 비교해 결과를 출력한다"""
    ds = DATASETS[name]
    base, other = load_rows(name, base_dir), load_rows(name, other_dir)
    lat_col = ds["lat"] if ds["lat"] in other[0] else "lat"
    lon_col = ds["lon"] if ds["lon"] in other[0] else "lon"

    def key(r: dict) -> tuple:
        return tuple(r.get(c, "") for c in KEYS[name])

    base_map, other_map = defaultdict(list), defaultdict(list)
    for r in base:
        base_map[key(r)].append(r)
    for r in other:
        other_map[key(r)].append(r)

    stats, changed = Counter(), []
    for k, rows in base_map.items():
        for b, o in zip(rows, other_map.get(k, [])):
            for bc, oc in ((ds["lat"], lat_col), (ds["lon"], lon_col)):
                bv, ov = b[bc].strip(), o[oc].strip()
                if bv == ov:
                    stats["같음"] += 1
                elif bv and ov and float(bv) == float(ov):
                    stats["숫자는 같고 표기만 다름"] += 1
                else:
                    stats["값 다름"] += 1
                    changed.append((k, bc, bv, ov))
                if bv and ov and decimals(ov) < decimals(bv):
                    stats["자릿수 줄어듦"] += 1

    only_base = [(k, len(v) - len(other_map.get(k, []))) for k, v in base_map.items() if len(v) > len(other_map.get(k, []))]
    only_other = [(k, len(v) - len(base_map.get(k, []))) for k, v in other_map.items() if len(v) > len(base_map.get(k, []))]
    log.info(f"\n■ {ds['label']}: 원본 {len(base):,}행 · 비교 대상 {len(other):,}행")
    log.info(f"  좌표(위도·경도 각각): {dict(stats)}")
    for k, n in only_base:
        log.info(f"  원본에만 {n}행: {k}")
    for k, n in only_other:
        log.info(f"  비교 대상에만 {n}행: {k}")
    for k, col, bv, ov in changed[:10]:
        log.info(f"  값 다름: {k} {col} {bv} → {ov}")


def main() -> None:
    """두 폴더에 모두 있는 데이터셋을 비교한다"""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", type=Path, default=RAW_DIR, help="원본 폴더 (기본 data/raw)")
    parser.add_argument("--other", type=Path, required=True, help="비교할 가공본 폴더")
    args = parser.parse_args()
    for name in DATASETS:
        if (args.base / f"{name}.csv").exists() and (args.other.expanduser() / f"{name}.csv").exists():
            compare(name, args.base, args.other.expanduser())


if __name__ == "__main__":
    main()
