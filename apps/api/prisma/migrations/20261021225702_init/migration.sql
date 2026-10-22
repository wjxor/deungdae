-- 첫 마이그레이션: docs/ERD.md의 Must 테이블 5개
-- 테이블·인덱스·FK는 `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`로 만들었고,
-- Prisma 스키마로 표현할 수 없는 것(PostGIS 확장, district CHECK, RLS, 시설 종류 기본값)은 직접 넣었다 (ERD "Prisma·PostGIS 메모")

-- PostGIS는 Supabase 권장대로 extensions 스키마에 둔다. 대시보드에서 이미 켰으면 넘어간다
-- postgres 사용자의 search_path에 extensions가 있어서 아래 geography 타입을 스키마 없이 쓸 수 있다
CREATE SCHEMA IF NOT EXISTS "extensions";
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA "extensions";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "facility_types" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,

    CONSTRAINT "facility_types_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "data_sources" (
    "id" SERIAL NOT NULL,
    "facility_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source_url" TEXT,
    "base_date" DATE,
    "raw_count" INTEGER NOT NULL,
    "loaded_count" INTEGER NOT NULL,
    "note" TEXT,
    "imported_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facilities" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "data_source_id" INTEGER NOT NULL,
    "source_key" TEXT,
    "name" TEXT,
    "address" TEXT,
    "district" TEXT,
    "location" geography(Point, 4326) NOT NULL,
    "coord_source" TEXT NOT NULL DEFAULT 'original',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_cache" (
    "id" SERIAL NOT NULL,
    "cache_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "route_mode" TEXT NOT NULL,
    "waypoints" JSONB NOT NULL DEFAULT '[]',
    "response" JSONB NOT NULL,
    "distance_m" INTEGER,
    "duration_s" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "route_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sun_times" (
    "date" DATE NOT NULL,
    "region" TEXT NOT NULL DEFAULT '대전',
    "sunrise" TIMESTAMPTZ NOT NULL,
    "sunset" TIMESTAMPTZ NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sun_times_pkey" PRIMARY KEY ("date","region")
);

-- CreateIndex
CREATE INDEX "facilities_type_idx" ON "facilities"("type");

-- CreateIndex
CREATE INDEX "facilities_location_idx" ON "facilities" USING GIST ("location");

-- CreateIndex
CREATE UNIQUE INDEX "route_cache_cache_key_key" ON "route_cache"("cache_key");

-- AddForeignKey
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_facility_type_fkey" FOREIGN KEY ("facility_type") REFERENCES "facility_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_type_fkey" FOREIGN KEY ("type") REFERENCES "facility_types"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 구 이름은 대전 5개 구만 받는다 (ERD facilities.district). 구를 모르는 행은 NULL로 둘 수 있다
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_district_check" CHECK ("district" IN ('동구', '중구', '서구', '유성구', '대덕구'));

-- RLS를 켜고 정책은 만들지 않는다. Data API(anon·authenticated 역할)로는 행이 하나도 보이지 않고,
-- 테이블 주인인 postgres로 붙는 NestJS 서버와 데이터 적재 스크립트는 영향을 받지 않는다
ALTER TABLE "facility_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "facilities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "route_cache" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sun_times" ENABLE ROW LEVEL SECURITY;

-- 시설 종류 5개와 안전점수 가중치 (REQUIREMENTS 안전점수 규칙, ERD facility_types)
-- 보안등 1·지구대 10은 9주차 MVP용 임시값이다 (지구대는 PR #21 승민 제안). 정해지면 이 파일이 아니라 UPDATE facility_types SET weight = ... 로 바꾼다
INSERT INTO "facility_types" ("code", "name", "weight") VALUES
    ('street_light', '가로등', 1),
    ('security_light', '보안등', 1),
    ('cctv', 'CCTV', 3),
    ('emergency_bell', '안심벨(비상벨)', 5),
    ('police', '지구대·파출소', 10);
