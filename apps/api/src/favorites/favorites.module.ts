import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FavoritesController } from './favorites.controller.js';
import { FavoritesService } from './favorites.service.js';

/** 즐겨찾기 (API.md 5-1장, FR-012). 로그인 확인은 AuthModule의 AuthGuard를 쓴다 */
@Module({
  imports: [AuthModule],
  controllers: [FavoritesController],
  providers: [FavoritesService],
})
export class FavoritesModule {}
