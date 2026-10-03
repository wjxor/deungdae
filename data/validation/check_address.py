"""주소 ↔ 좌표 전수 대조 — 비상벨·CCTV·보안등 좌표를 카카오 주소 검색 결과와 비교해 300m 넘게 어긋난 행을 남긴다

- 행마다 첫 번째 주소(도로명 → 지번 순)로 검색하고, 결과가 없을 때만 다른 주소로 다시 검색한다
- '어긋남'은 둘 중 어느 쪽이 틀렸는지까지는 말해 주지 않는다. 정제할 때 행별로 확인한다
- 결과: address_mismatch.csv. 카카오가 돌려준 좌표는 공개 저장소에 쌓지 않으려고 거리만 남긴다
  (검색 좌표가 필요하면 로컬 캐시 .cache/geocode_cache.json에서 주소로 찾는다)
"""
from __future__ import annotations

from collections import Counter, defaultdict

from common import (DATASETS, DISTRICTS, OUT_DIR, UNKNOWN, Geocoder, coord, distance_m, district_of,
                    in_daejeon, load_rows, log, to_query, usable_addresses, write_csv)

TARGETS = ["emergency_bell", "cctv", "security_light"]
FAR_M = 300
BANDS = ["300m~1km", "1~20km", "20km 이상"]
# 서구 CCTV에서 확인된 패턴: 위도는 그대로, 경도만 0.0175° 작게 (약 1.57km 서쪽)
LON_SHIFT = 0.0175


def band_of(d: float) -> str:
    """거리 구간"""
    return BANDS[0] if d < 1000 else (BANDS[1] if d < 20000 else BANDS[2])


def note_of(point: tuple[float, float], found: list[float]) -> str:
    """눈에 띄는 패턴 표시"""
    notes = []
    if not in_daejeon(point):
        notes.append("대전 범위 밖")
    if abs((found[1] - point[1]) - LON_SHIFT) < 0.0003 and abs(found[0] - point[0]) < 0.003:
        notes.append("경도 0.0175° 서쪽 밀림")
    return ", ".join(notes)


def main() -> None:
    """세 데이터셋을 주소 검색과 대조해 구별 요약을 출력하고 어긋난 행을 저장한다"""
    data = {name: load_rows(name) for name in TARGETS}
    geocoder = Geocoder()

    # 1차: 행마다 첫 주소, 2차: 첫 주소 검색이 실패한 행의 나머지 주소
    first = {to_query(usable_addresses(r, n)[0]) for n in TARGETS for r in data[n] if usable_addresses(r, n)}
    geocoder.fetch_all(first, "1차(첫 주소)")
    second = set()
    for n in TARGETS:
        for r in data[n]:
            usable = usable_addresses(r, n)
            if usable and not geocoder.get(to_query(usable[0])):
                second.update(to_query(a) for a in usable[1:])
    geocoder.fetch_all(second, "2차(검색 실패 행의 다른 주소)")

    mismatches = []
    for n in TARGETS:
        total, checked, no_addr, no_result = Counter(), Counter(), Counter(), Counter()
        far = defaultdict(Counter)
        for r in data[n]:
            gu = district_of(r, n)
            total[gu] += 1
            point, usable = coord(r, n), usable_addresses(r, n)
            if not usable or point is None:
                no_addr[gu] += 1
                continue
            hit = next(((a, geocoder.get(to_query(a))) for a in usable if geocoder.get(to_query(a))), None)
            if not hit:
                no_result[gu] += 1
                continue
            address, found = hit
            d = distance_m(point, (found[0], found[1]))
            checked[gu] += 1
            if d > FAR_M:
                far[gu][band_of(d)] += 1
                mismatches.append({"dataset": DATASETS[n]["label"], "id": r[DATASETS[n]["id"]], "gu": gu,
                                   "distance_m": round(d), "band": band_of(d), "address": address,
                                   "lat": r[DATASETS[n]["lat"]].strip(), "lon": r[DATASETS[n]["lon"]].strip(),
                                   "note": note_of(point, found)})

        log.info(f"\n■ {DATASETS[n]['label']} (원본 {len(data[n]):,}행)")
        log.info("구 | 전체 | 판정 | 주소 없음 | 검색 실패 | " + " | ".join(BANDS) + " | 어긋남 | 비율")
        for gu in DISTRICTS + [UNKNOWN, "합계"]:
            if gu == "합계":
                t, c, na, nr = (sum(x.values()) for x in (total, checked, no_addr, no_result))
                b = Counter()
                for v in far.values():
                    b.update(v)
            elif total[gu]:
                t, c, na, nr, b = total[gu], checked[gu], no_addr[gu], no_result[gu], far[gu]
            else:
                continue
            s = sum(b.values())
            log.info(f"{gu} | {t:,} | {c:,} | {na:,} | {nr:,} | " + " | ".join(str(b[x]) for x in BANDS)
                     + f" | {s} | {s / max(c, 1) * 100:.1f}%")

    notes = Counter((m["dataset"], m["gu"], m["note"]) for m in mismatches if m["note"])
    log.info("\n패턴: " + (", ".join(f"{d} {g} {n} {c}행" for (d, g, n), c in sorted(notes.items())) or "없음"))
    order = {DATASETS[n]["label"]: i for i, n in enumerate(TARGETS)}
    mismatches.sort(key=lambda m: (order[m["dataset"]], DISTRICTS.index(m["gu"]) if m["gu"] in DISTRICTS else 9,
                                   -m["distance_m"]))
    write_csv(OUT_DIR / "address_mismatch.csv", mismatches,
              ["dataset", "id", "gu", "distance_m", "band", "address", "lat", "lon", "note"])


if __name__ == "__main__":
    main()
