# data — 공공데이터 수집·정제 (담당: 정근영)

Python 3.12+ (pandas, GeoPandas) 전처리 노트북·스크립트를 둔다.

- **원본 파일(CSV·XLS 등)은 커밋하지 않는다.** `data/raw/`에 내려받고, 아래 표에 출처와 다운로드 방법만 기록한다
- 좌표계는 전부 WGS84(EPSG:4326)로 변환해 적재한다
- 결측·대전 밖 행은 제거하고 제거 건수를 기록한다
- 원본 좌표 검증 스크립트와 결과 목록(주소와 어긋난 행, 소수점 4자리 행)은 [`validation/`](validation/README.md)

## 데이터 출처

| 데이터 | 출처 | 다운로드 방법 | 원본 건수 | 적재 건수 |
|---|---|---|---|---|
| 대전광역시 가로등 현황 | data.go.kr/data/15110054 | API — `street_light` → `raw/street_light.csv` | 43,082 | |
| 대전광역시 보안등 조회 | data.go.kr/data/15110685 | API — `security_light` → `raw/security_light.csv` | 28,579 | |
| 대전광역시 방범용 CCTV | data.go.kr/data/15109459 | API — `cctv` → `raw/cctv.csv` | 2,985 | |
| 행정안전부 안전비상벨 위치정보 | 공공데이터포털 | API — `emergency_bell` → `raw/emergency_bell.csv`. 전국 데이터라 대전 5개 구 기관코드로 나눠 조회 | 575 | |
| 경찰청 전국 지구대·파출소 주소 | data.go.kr/data/15077036 | API — `police` → `raw/police.csv`. 전국을 받아 `시도청`이 `대전청`인 행만 저장 | 31 | |
| ~~국립중앙의료원 전국 약국 정보~~ (수집 안 함 — 24시 시설 제외, 2026-10-10) | data.go.kr/data/15000576 | | | |

- 다운로드 방법의 이름은 아래 "원본 수집"의 `collect_raw_data.py` 인자
- 원본 건수는 2026-09-30 근영 수집본(노션 "캡스톤" 3.2 `raw.zip`) 기준. 다시 수집하면 기관이 데이터를 갱신한 만큼 달라질 수 있다
- 적재 건수는 정제 기준(ROADMAP "정제 때 정할 것")을 정하고 DB에 넣은 뒤 채운다

## 원본 수집

공공데이터포털 API로 5종을 받아 `data/raw/`에 CSV로 저장한다. 공공데이터포털 서비스 키가 필요하다.

```bash
# 1. 패키지 설치 — 레포 루트에서 (가상환경 권장)
pip install -r data/requirements.txt

# 2. 루트 .env에 공공데이터포털 서비스 키를 넣는다 (.env.example 참고)
#    DATA_GO_KR_KEY=...

# 3. 수집 — 인자가 없으면 5종 전부, 이름을 주면 그것만
python data/collect_raw_data.py
python data/collect_raw_data.py cctv police

# 4. 건수·중복 검사
python data/check_duplication.py
```

| 파일 | 내용 |
|---|---|
| `collect_raw_data.py` | 5종 원본 수집. 이름: `security_light`(보안등) · `cctv` · `street_light`(가로등) · `emergency_bell`(비상벨) · `police`(지구대·파출소) |
| `check_duplication.py` | 종류별 전체 건수, 완전 중복, ID 중복, 같은 좌표 중복 출력 |
| `requirements.txt` | `requests`, `pandas`, `python-dotenv` |

- 어느 폴더에서 실행해도 `data/raw/`에 저장하고 거기서 읽는다
- 서비스 키는 인코딩 키·디코딩 키 어느 쪽을 넣어도 된다 (스크립트가 디코딩해서 쓴다)
- API 오류가 나면 상태 코드와 서버 응답 앞부분만 출력한다. 서비스 키가 든 URL은 출력하지 않아서 오류 메시지를 그대로 공유해도 된다
- `raw.zip` 원본으로 `check_duplication.py`를 돌리면 위 원본 건수와 CCTV 같은 좌표 461곳이 그대로 나온다 (ROADMAP 데이터 검증)
