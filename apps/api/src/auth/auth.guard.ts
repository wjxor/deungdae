import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { unauthorized } from '../common/api-exception.js';
import { AuthService } from './auth.service.js';

/** 가드를 지난 요청. 로그인한 회원 id가 붙어 있다 */
export type AuthedRequest = Request & { userId: number };

/**
 * `Authorization: Bearer <로그인 토큰>`을 확인하고 회원 id를 요청에 붙인다.
 * 토큰이 없으면 401 "로그인이 필요해요", 틀리거나 만료면 401 (AuthService)
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  /** 토큰이 맞으면 통과시키고 `request.userId`를 채운다 */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    if (!match) throw unauthorized('로그인이 필요해요');
    req.userId = await this.auth.userIdFromToken(match[1]);
    return true;
  }
}
