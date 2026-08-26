import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from '../decorators/current-user.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { hasRole, Role, ROLE_LABEL } from '../enums/role.enum';

/**
 * `@Roles(Role.MANAGER)` — ДООД хязгаар. Дээд дүр автоматаар нэвтэрнэ
 * (admin > manager > reception). Метадата байхгүй бол дүрийн шалгалт хийхгүй
 * (нэвтэрсэн байхад л хангалттай).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const min = this.reflector.getAllAndOverride<Role | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!min) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    // `@Public()` дээр `@Roles` тавихгүй гэж үзнэ; user байхгүй бол JwtAuthGuard
    // аль хэдийн зогсоосон байх ёстой.
    if (!user) return false;

    if (!hasRole(user.role, min)) {
      throw new ForbiddenException(
        `Энэ үйлдэлд «${ROLE_LABEL[min]}» ба түүнээс дээш эрх шаардлагатай`,
      );
    }
    return true;
  }
}
