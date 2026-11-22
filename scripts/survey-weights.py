"""
가중치 설문(구글폼) 응답으로 시설 가중치를 구한다 (FR-006, ROADMAP "결정된 것" 시설 가중치).

실행 (레포 루트에서):
    python3 scripts/survey-weights.py "data/raw/<구글폼에서 받은 응답>.csv"

- 쌍대비교 6문항(AHP)만 쓴다. 응답마다 4×4 비교 행렬을 만들고, 모든 응답의 답을 칸마다 기하평균해 행렬 하나로 합친 뒤
  그 행렬의 고유벡터로 시설 4종의 비율을 구한다. 합친 행렬의 CR이 0.1 이하여야 쓴다 (2026-11-22 상협).
  처음 정한 방법(응답마다 CR 0.1을 넘으면 빼기, 승민 PR #84)은 11/21 응답 21명 중 3명만 남아서 바꿨다
- 그 비율을 가로등·보안등 비율로 나눠 가로등·보안등을 1로 맞춘다 (정규화, PR #86). 보안등은 설문에서 가로등과 한 문항이라 같은 값이다
- 9단계 답은 Saaty 척도의 홀수로 옮긴다: 비슷하다 1, 조금 더 3, 더 5, 훨씬 더 7, 압도적으로 더 9 (`LEVELS`)
- 시험 응답(`TEST_RESPONSES`)은 뺀다. 15주차 응답은 가중치에 넣지 않으므로 14주차까지 받은 파일로 돌린다
- 결과는 화면에만 출력한다. 서버에는 마이그레이션(`facility_types.weight` UPDATE)으로 넣고,
  넣기 전에는 출력된 `--weights` 값으로 scripts/safety-score-experiment.mjs를 돌려 200쌍을 본다
- 연락처·자유 응답 등 다른 열은 읽지 않는다. 연락처 열은 파일을 받자마자 지운다
"""
from __future__ import annotations

import csv
import math
import sys
from pathlib import Path

# 설문 문항 순서대로의 시설과 문항·답에 쓰인 이름 (답은 "<이름><조사> <정도> 더 안심된다")
FACILITIES = ["lights", "cctv", "emergency_bell", "police"]
NAMES = {"lights": "가로등·보안등", "cctv": "CCTV", "emergency_bell": "안심벨", "police": "지구대·파출소"}
SUBJECTS = {"lights": "가로등·보안등이", "cctv": "CCTV가", "emergency_bell": "안심벨이", "police": "지구대·파출소가"}
SAME = "비슷하다"
LEVELS = {"조금 더 안심된다": 3, "더 안심된다": 5, "훨씬 더 안심된다": 7, "압도적으로 더 안심된다": 9}

# 상협이 폼을 만들고 넣어 본 첫 응답 (2026-11-06, ROADMAP "지금 할 일" 가중치 설문)
TEST_RESPONSES = {"2026/11/06 12:23:42 오전 GMT+9"}

CR_LIMIT = 0.1
RANDOM_INDEX_4 = 0.90  # Saaty 무작위 지수 (n = 4)


def read_responses(path: Path) -> tuple[list[str], list[dict[tuple[str, str], str]]]:
    """타임스탬프와 쌍대비교 6문항의 답만 읽는다. 문항 열은 "<이름> vs <이름>"이다"""
    with path.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    header, body = rows[0], rows[1:]
    by_name = {name: key for key, name in NAMES.items()}
    pair_cols = {}
    for i, title in enumerate(header):
        parts = title.split(" vs ")
        if len(parts) == 2 and parts[0] in by_name and parts[1] in by_name:
            pair_cols[(by_name[parts[0]], by_name[parts[1]])] = i
    if len(pair_cols) != 6:
        sys.exit(f"쌍대비교 문항이 6개가 아니에요 ({len(pair_cols)}개). 열 이름을 확인해 주세요")
    stamps = [r[0] for r in body]
    answers = [{pair: r[i] for pair, i in pair_cols.items()} for r in body]
    return stamps, answers


def judgment(pair: tuple[str, str], answer: str) -> float:
    """"a vs b" 문항의 답 → a가 b보다 몇 배 안심되는지 (Saaty 척도, b 쪽이면 역수)"""
    a, b = pair
    if answer == SAME:
        return 1.0
    for side, value_of in ((a, lambda v: v), (b, lambda v: 1 / v)):
        subject = SUBJECTS[side]
        if answer.startswith(subject):
            level = answer[len(subject):].strip()
            if level in LEVELS:
                return value_of(LEVELS[level])
    sys.exit(f"알 수 없는 답이에요: {NAMES[a]} vs {NAMES[b]} → {answer!r}")


def matrix(answer: dict[tuple[str, str], str]) -> list[list[float]]:
    """응답 하나의 4×4 쌍대비교 행렬 (대각선 1, 역수 대칭)"""
    idx = {key: k for k, key in enumerate(FACILITIES)}
    m = [[1.0] * 4 for _ in range(4)]
    for pair, text in answer.items():
        v = judgment(pair, text)
        i, j = idx[pair[0]], idx[pair[1]]
        m[i][j], m[j][i] = v, 1 / v
    return m


def priority(m: list[list[float]]) -> tuple[list[float], float]:
    """주고유벡터(합 1)와 CR. 거듭제곱법으로 구한다 — 양수 역수 행렬이라 수렴한다"""
    n = len(m)
    w = [1 / n] * n
    for _ in range(1000):
        nxt = [sum(m[i][j] * w[j] for j in range(n)) for i in range(n)]
        total = sum(nxt)
        nxt = [x / total for x in nxt]
        done = max(abs(x - y) for x, y in zip(nxt, w)) < 1e-12
        w = nxt
        if done:
            break
    lambda_max = sum(sum(m[i][j] * w[j] for j in range(n)) / w[i] for i in range(n)) / n
    cr = ((lambda_max - n) / (n - 1)) / RANDOM_INDEX_4
    return w, cr


def geometric_mean(values: list[float]) -> float:
    """기하평균"""
    return math.exp(sum(math.log(v) for v in values) / len(values))


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    stamps, answers = read_responses(Path(sys.argv[1]))
    kept = [a for s, a in zip(stamps, answers) if s not in TEST_RESPONSES]
    matrices = [matrix(a) for a in kept]
    merged_matrix = [[geometric_mean([m[i][j] for m in matrices]) for j in range(4)] for i in range(4)]
    ratios, cr = priority(merged_matrix)
    crs = sorted(priority(m)[1] for m in matrices)

    print(f"응답 {len(stamps)}명 · 시험 응답 {len(stamps) - len(kept)}명 뺌 → {len(kept)}명의 답을 칸마다 기하평균해 합침")
    print(f"합친 행렬의 CR {cr:.3f} (기준 {CR_LIMIT} 이하) · 참고: 응답별 CR 최소 {crs[0]:.3f} · 중앙 {crs[len(crs) // 2]:.3f} · 최대 {crs[-1]:.3f}")
    if cr > CR_LIMIT:
        sys.exit(f"합친 행렬의 CR이 {CR_LIMIT}을 넘어서 가중치로 쓰지 않아요")

    multipliers = [x / ratios[0] for x in ratios]
    weights = {key: round(v, 2) for key, v in zip(FACILITIES, multipliers)}

    print("\n시설 | 비율(합 100%) | 가로등·보안등 = 1 배수 → 가중치(소수 둘째 자리)")
    for key, r, mlt in zip(FACILITIES, ratios, multipliers):
        print(f"  {NAMES[key]} | {100 * r:.1f}% | {mlt:.3f} → {weights[key]}")

    light = weights["lights"]
    print("\n실험 스크립트 (DB는 그대로, 이 연결에서만 가중치를 바꿔 센다):")
    print(f"  --weights street_light={light},security_light={light},cctv={weights['cctv']},"
          f"emergency_bell={weights['emergency_bell']},police={weights['police']}")
    print("\n마이그레이션 SQL:")
    for code, key in (("street_light", "lights"), ("security_light", "lights"), ("cctv", "cctv"),
                      ("emergency_bell", "emergency_bell"), ("police", "police")):
        print(f"  UPDATE \"facility_types\" SET \"weight\" = {weights[key]} WHERE \"code\" = '{code}';")


if __name__ == "__main__":
    main()
