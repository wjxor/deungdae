-- 위험 제보 테이블 (FR-009, 2026-11-23). docs/ERD.md reports
-- 테이블·인덱스·FK는 `prisma migrate diff --from-schema <이전 schema.prisma> --to-schema prisma/schema.prisma --script`로 만들었고,
-- Prisma 스키마로 못 쓰는 CHECK 두 개와 RLS는 직접 넣었다.
-- 새 테이블만 더해서 배포돼 있는 코드에는 영향이 없다 — merge 전에 공용 DB에 넣어도 된다
-- 회원만 제보하고 사진은 받지 않는다. 탈퇴하면 제보는 남기고 user_id만 비운다(ON DELETE SET NULL) — PR #93

-- CreateTable
CREATE TABLE "reports" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "location" geography(Point, 4326) NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_location_idx" ON "reports" USING GIST ("location");

-- CreateIndex
CREATE INDEX "reports_created_at_idx" ON "reports"("created_at");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- 유형은 화면 S4와 같은 세 가지만 (우범지역은 2026-11-23에 뺐다, PR #92)
ALTER TABLE "reports" ADD CONSTRAINT "reports_type_check" CHECK ("type" IN ('dark', 'no_cctv', 'others'));

-- 설명은 200자까지 (서버에서도 센다). 빈칸뿐인 설명은 서버가 null로 바꿔 넣는다
ALTER TABLE "reports" ADD CONSTRAINT "reports_description_check" CHECK ("description" IS NULL OR char_length("description") BETWEEN 1 AND 200);

-- 회원과 위치가 이어진 테이블이라 Data API로 읽히지 않게 막는다 (users·즐겨찾기와 같게, 정책 없음)
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;
