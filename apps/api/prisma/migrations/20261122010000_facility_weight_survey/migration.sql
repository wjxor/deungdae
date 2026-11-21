-- 시설 가중치를 가중치 설문(구글폼) AHP 비율로 바꾼다 (FR-006, ROADMAP "결정된 것" 시설 가중치, PR #84·#86)
-- 11/21까지 받은 22명 중 시험 응답 1명을 뺀 21명. 쌍대비교 답(1·3·5·7·9)을 칸마다 기하평균한 행렬의 고유벡터, CR 0.001
-- 가로등·보안등을 1로 맞춘 배수라 "원점수 10 = 100점"은 그대로다. 보안등은 설문에서 가로등과 한 문항이라 같은 값
-- 계산: python3 scripts/survey-weights.py <응답 CSV>. 응답이 쌓이면 14주차까지 새 마이그레이션으로 다시 넣는다
-- 그 전 값: 가로등 1 · 보안등 1 · CCTV 3 · 안심벨 5 · 지구대 10 (3주차 초안 + 2026-10-21 MVP 임시값)
UPDATE "facility_types" SET "weight" = 1 WHERE "code" = 'street_light';
UPDATE "facility_types" SET "weight" = 1 WHERE "code" = 'security_light';
UPDATE "facility_types" SET "weight" = 0.99 WHERE "code" = 'cctv';
UPDATE "facility_types" SET "weight" = 0.75 WHERE "code" = 'emergency_bell';
UPDATE "facility_types" SET "weight" = 3.77 WHERE "code" = 'police';
