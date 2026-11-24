import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

/** 위험 제보 (API.md 6장, FR-009). 로그인 확인은 AuthModule의 AuthGuard를 쓴다 */
@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
