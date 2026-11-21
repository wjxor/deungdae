-- 시설 가중치를 설문 AHP 비율(가로등·보안등을 1로 맞춘 배수)로 넣으려고 정수에서 실수로 바꾼다
-- (FR-006, ROADMAP "결정된 것" 시설 가중치, PR #84·#86). 값은 그대로(1·1·3·5·10)라 이 마이그레이션만으로는 점수가 바뀌지 않는다
-- AlterTable
ALTER TABLE "facility_types" ALTER COLUMN "weight" SET DATA TYPE DOUBLE PRECISION;
