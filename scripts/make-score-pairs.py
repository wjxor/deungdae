"""
안전점수 분포 실험용 귀갓길 쌍 50개를 만든다 (docs/safety-score-experiment.md).

실행 (레포 루트에서):
    python3 scripts/make-score-pairs.py > scripts/route-pairs-score.json

- 5개 구마다 10쌍. 도착은 그 구의 보안등 자리(주택가 골목), 출발은 그 구의 가로등 자리(큰길)
- 직선거리 0.5~1km 3쌍, 1~1.5km 4쌍, 1.5~2.5km 3쌍. 도착지끼리 700m 이상 떨어뜨려 한 동네에 몰리지 않게 한다
- 시드를 고정해서 같은 정제 결과(data/processed)면 늘 같은 쌍이 나온다
- 필요: data/processed/facilities_street_light.csv, facilities_security_light.csv (data/README.md "정제")
"""
import csv
import json
import math
import random
import sys
from pathlib import Path

SEED = 20261025
PROCESSED = Path(__file__).resolve().parent.parent / "data" / "processed"
DISTRICTS = {"동구": "dong", "중구": "jung", "서구": "seo", "유성구": "yuseong", "대덕구": "daedeok"}
BANDS_M = [(500, 1000)] * 3 + [(1000, 1500)] * 4 + [(1500, 2500)] * 3
MIN_GAP_M = 700


def load(kind: str) -> list[dict]:
    """정제 결과 CSV 한 종류를 읽는다"""
    with open(PROCESSED / f"facilities_{kind}.csv", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """두 (위도, 경도) 사이 거리(m). 하버사인 (서버·프론트와 같은 식)"""
    r = math.radians
    h = math.sin(r(b[0] - a[0]) / 2) ** 2 + math.cos(r(a[0])) * math.cos(r(b[0])) * math.sin(r(b[1] - a[1]) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def point(row: dict) -> tuple[float, float]:
    return float(row["lat"]), float(row["lng"])


def main() -> None:
    random.seed(SEED)
    street, security = load("street_light"), load("security_light")
    pairs = []
    for gu, roman in DISTRICTS.items():
        origins = [r for r in street if r["district"] == gu]
        dests = [r for r in security if r["district"] == gu]
        random.shuffle(dests)
        chosen: list[tuple[float, float]] = []
        for lo, hi in BANDS_M:
            for d in dests:
                dp = point(d)
                if any(distance_m(dp, c) < MIN_GAP_M for c in chosen):
                    continue
                candidates = [o for o in origins if lo <= distance_m(point(o), dp) <= hi]
                if not candidates:
                    continue
                o = random.choice(candidates)
                chosen.append(dp)
                op = point(o)
                n = sum(1 for p in pairs if p["district"] == gu) + 1
                pairs.append({
                    "id": f"score-{roman}-{n:02d}",
                    "district": gu,
                    "scene": f"큰길(가로등) → 주택가(보안등), 직선 {lo / 1000:g}~{hi / 1000:g}km",
                    "origin": {"name": f"가로등 {o['source_key'] or ''}".strip(), "location": {"lat": op[0], "lng": op[1]}},
                    "destination": {"name": f"보안등 {d['name'] or ''}".strip(), "location": {"lat": dp[0], "lng": dp[1]}},
                })
                break
    json.dump(pairs, sys.stdout, ensure_ascii=False, indent=2)
    print()


if __name__ == "__main__":
    main()
