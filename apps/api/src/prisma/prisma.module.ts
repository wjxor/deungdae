import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

// DB 연결은 서버 전체에서 하나만 쓴다. 다른 모듈은 import 없이 PrismaService를 주입받는다
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
