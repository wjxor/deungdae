-- 즐겨찾기 테이블 2개 (FR-012, 2026-11-22). docs/ERD.md favorite_places·favorite_routes
-- 테이블·인덱스·FK는 `prisma migrate diff --from-schema <이전 schema.prisma> --to-schema prisma/schema.prisma --script`로 만들었고,
-- RLS는 users와 같게 직접 넣었다 (정책 없음 — Data API 역할로는 행이 안 보이고, 테이블 주인인 postgres로 붙는 서버는 영향 없음).
-- 새 테이블만 더해서 배포돼 있는 코드에는 영향이 없다 — merge 전에 공용 DB에 넣어도 된다
-- payload는 서버가 AES-256-GCM으로 암호화한 장소 정보, place_key·route_key는 HMAC 값이라 DB만 봐서는 위치를 알 수 없다 (NFR-004)

-- CreateTable
CREATE TABLE "favorite_places" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "place_key" TEXT NOT NULL,
    "payload" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorite_routes" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "route_key" TEXT NOT NULL,
    "payload" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "favorite_places_user_id_place_key_key" ON "favorite_places"("user_id", "place_key");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_routes_user_id_route_key_key" ON "favorite_routes"("user_id", "route_key");

-- AddForeignKey
ALTER TABLE "favorite_places" ADD CONSTRAINT "favorite_places_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_routes" ADD CONSTRAINT "favorite_routes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 회원 위치가 담긴 테이블이라 Data API로 읽히지 않게 막는다
ALTER TABLE "favorite_places" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "favorite_routes" ENABLE ROW LEVEL SECURITY;
