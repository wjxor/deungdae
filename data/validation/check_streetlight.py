"""가로등 좌표 검사 — 주소가 없어 주소 대조 대신 '같은 구 보안등이 1km 안에 있는지'로 본다

보안등은 주소에서 구를 뽑을 수 있어 기준점으로 쓴다. 1km 안에 같은 구 보안등이 하나도 없으면
다른 구나 엉뚱한 곳에 찍혔을 가능성이 있다. 큰길(보안등이 드문 곳)의 정상 가로등도 섞이고,
수십~수백 m 오차는 이 방법으로 잡지 못한다. 결과는 출력만 한다.
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict

from common import DISTRICTS, UNKNOWN, coord, district_of, in_daejeon, load_rows, log

CELL = 0.01  # 격자 크기(도) ≈ 위도 1.1km, 경도 0.9km
NEAR_M = 1000
BANDS = ["1~3km", "3~10km", "10km 이상"]


def flat_distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    """근거리용 평면 근사 거리(m)"""
    dy = (a[0] - b[0]) * 111_320
    dx = (a[1] - b[1]) * 111_320 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dx, dy)


def cell_of(p: tuple[float, float]) -> tuple[int, int]:
    """격자 칸 번호"""
    return int(p[0] / CELL), int(p[1] / CELL)


def main() -> None:
    """가로등마다 같은 구 보안등까지의 거리를 확인해 구별로 센다"""
    grid = defaultdict(lambda: defaultdict(list))  # 구 → 격자 칸 → 보안등 좌표
    anchors = defaultdict(list)
    for r in load_rows("security_light"):
        gu, p = district_of(r, "security_light"), coord(r, "security_light")
        if gu != UNKNOWN and p:
            grid[gu][cell_of(p)].append(p)
            anchors[gu].append(p)

    total, outside, far = Counter(), Counter(), defaultdict(Counter)
    farthest = []
    for r in load_rows("street_light"):
        gu, p = district_of(r, "street_light"), coord(r, "street_light")
        total[gu] += 1
        if p is None or gu == UNKNOWN:
            continue
        if not in_daejeon(p):
            outside[gu] += 1
        cy, cx = cell_of(p)
        near = any(flat_distance_m(p, q) <= NEAR_M
                   for dy in (-1, 0, 1) for dx in (-2, -1, 0, 1, 2)
                   for q in grid[gu].get((cy + dy, cx + dx), ()))
        if near:
            continue
        d = min(flat_distance_m(p, q) for q in anchors[gu])  # 같은 구 보안등까지 실제 최단 거리
        far[gu][BANDS[0] if d < 3000 else (BANDS[1] if d < 10000 else BANDS[2])] += 1
        farthest.append((round(d), gu, r["관리번호"]))

    log.info("구 | 전체 | 대전 범위 밖 | 같은 구 보안등이 1km 안에 없음 (" + " / ".join(BANDS) + ") | 합계")
    for gu in DISTRICTS + ["합계"]:
        if gu == "합계":
            t, o = sum(total.values()), sum(outside.values())
            b = Counter()
            for v in far.values():
                b.update(v)
        else:
            t, o, b = total[gu], outside[gu], far[gu]
        log.info(f"{gu} | {t:,} | {o} | " + " / ".join(str(b[x]) for x in BANDS) + f" | {sum(b.values())}")
    if farthest:
        d, gu, no = max(farthest)
        log.info(f"\n가장 먼 가로등: {gu} 관리번호 {no}, 같은 구 보안등까지 {d:,}m")


if __name__ == "__main__":
    main()
