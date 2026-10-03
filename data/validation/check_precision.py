"""좌표 소수점 자릿수 검사 — 4자리 이하(약 10m 단위)로 등록된 행을 구별로 세고 목록으로 남긴다

소수점 4자리 = 0.0001° ≈ 위도 11m, 경도 9m. 반올림이면 최대 약 7m, 버림이면 최대 약 14m 어긋난다.
끝자리 0은 표기 차이라 세지 않는다 (36.2990 → 실제로는 4자리여도 36.299로 저장될 수 있음).
결과: low_precision.csv
"""
from __future__ import annotations

from collections import Counter, defaultdict

from common import DATASETS, DISTRICTS, OUT_DIR, UNKNOWN, decimals, district_of, load_rows, log, write_csv

MAX_DECIMALS = 4


def main() -> None:
    """네 데이터셋의 자릿수 분포를 구별로 출력하고 4자리 이하 행을 저장한다"""
    low_rows = []
    for name, ds in DATASETS.items():
        rows = load_rows(name)
        by_gu = defaultdict(Counter)
        for r in rows:
            gu = district_of(r, name)
            precision = max(decimals(r[ds["lat"]]), decimals(r[ds["lon"]]))
            by_gu[gu][precision] += 1
            if precision <= MAX_DECIMALS:
                address = next((r[c].strip() for c in ds["address"] if (r.get(c) or "").strip()), "")
                low_rows.append({"dataset": ds["label"], "id": r[ds["id"]], "gu": gu, "decimals": precision,
                                 "address": address, "lat": r[ds["lat"]].strip(), "lon": r[ds["lon"]].strip()})

        log.info(f"\n■ {ds['label']} {len(rows):,}행 — 구 | 전체 | {MAX_DECIMALS}자리 이하 | 자릿수 분포")
        for gu in DISTRICTS + [UNKNOWN]:
            if by_gu[gu]:
                low = sum(v for k, v in by_gu[gu].items() if k <= MAX_DECIMALS)
                log.info(f"{gu} | {sum(by_gu[gu].values()):,} | {low:,} | {dict(sorted(by_gu[gu].items()))}")

    write_csv(OUT_DIR / "low_precision.csv", low_rows, ["dataset", "id", "gu", "decimals", "address", "lat", "lon"])


if __name__ == "__main__":
    main()
