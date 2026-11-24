-- 익명 제보자 키 (FR-010, 2026-11-24). docs/ERD.md users·reports
-- 제보 감점은 "구간 30m 안 최근 30일 제보를 서로 다른 회원 3명 이상이 올렸을 때"다 (PR #93 1-4).
-- 탈퇴하면 reports.user_id가 비워져(SET NULL) 누가 올렸는지 구분할 수 없어서, 회원마다 무작위 키를 두고 제보에 복사해 둔다.
-- 키는 탈퇴해도 제보에 남아 탈퇴 전과 같은 사람 수로 센다 — A·B가 같은 곳에 올리고 둘 다 탈퇴해도 2명, A 혼자 3번 올리고 탈퇴해도 1명.
-- 회원 id에서 계산한 값이 아니라 무작위라, 회원 행이 지워지면 키로 누구였는지 알 수 없다.
-- ALTER 두 줄은 `prisma migrate diff --from-schema <이전 schema.prisma> --to-schema prisma/schema.prisma --script`로 만들었고,
-- 이미 있는 제보를 채우는 UPDATE와 트리거는 직접 넣었다 (Prisma 스키마로는 쓰지 못한다).
-- 배포돼 있는 코드(PR #95)는 INSERT에 reporter_key를 넣지 않지만 트리거가 채워서, merge 전에 공용 DB에 넣어도 된다

-- AlterTable — 기존 회원은 행마다 다른 무작위 값으로 채워진다
ALTER TABLE "users" ADD COLUMN "report_key" UUID NOT NULL DEFAULT gen_random_uuid();

-- AlterTable — 이미 있는 제보를 채운 뒤 NOT NULL로 바꾼다. 작성자가 이미 탈퇴한 제보는 누구였는지 몰라 제보마다 다른 키다
ALTER TABLE "reports" ADD COLUMN "reporter_key" UUID;
UPDATE "reports" r SET "reporter_key" = COALESCE((SELECT u."report_key" FROM "users" u WHERE u."id" = r."user_id"), gen_random_uuid());
ALTER TABLE "reports" ALTER COLUMN "reporter_key" SET NOT NULL;

-- 제보를 넣을 때 작성자의 report_key를 복사한다. 서버 INSERT는 이 열을 넣지 않는다 (src/reports/reports.service.ts).
-- 작성자가 있으면 늘 그 회원의 키라 다른 값을 넣어도 바뀌지 않는다. 작성자가 없는 행(DB에 직접 넣은 행)은 넣은 값, 없으면 행마다 다른 키다.
-- search_path를 비워 두고 테이블 이름을 스키마까지 적는다 (Supabase 권장. gen_random_uuid는 pg_catalog라 그대로 찾는다)
CREATE FUNCTION "public"."reports_fill_reporter_key"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW."reporter_key" := COALESCE(
    (SELECT u."report_key" FROM "public"."users" u WHERE u."id" = NEW."user_id"),
    NEW."reporter_key",
    gen_random_uuid()
  );
  RETURN NEW;
END
$$;

CREATE TRIGGER "reports_fill_reporter_key" BEFORE INSERT ON "reports"
  FOR EACH ROW EXECUTE FUNCTION "public"."reports_fill_reporter_key"();
