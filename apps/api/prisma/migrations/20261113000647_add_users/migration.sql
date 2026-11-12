-- 회원 테이블 (FR-011 서버 카카오 로그인, 2026-11-13). docs/ERD.md users
-- 테이블·인덱스는 `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`로 만들었고,
-- RLS는 init의 다른 5개 테이블과 같게 직접 넣었다 (정책 없음 — Data API 역할로는 행이 안 보이고, 테이블 주인인 postgres로 붙는 서버는 영향 없음)

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_provider_provider_id_key" ON "users"("provider", "provider_id");

-- 회원 정보라 Data API로 읽히지 않게 막는다
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
