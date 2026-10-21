import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// 환경변수는 저장소 루트의 .env 하나에 둔다 (apps/web과 같은 파일). npm 스크립트는 apps/api에서 실행된다
config({ path: '../../.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Prisma CLI(마이그레이션)는 Supabase Session pooler(5432)로 붙는다. 앱은 DATABASE_URL(Transaction pooler)을 쓴다
    // generate만 할 때는 DB가 필요 없어서, 값이 없어도 설정을 읽을 수 있게 빈 문자열로 둔다
    url: process.env.DIRECT_URL ?? '',
  },
});
