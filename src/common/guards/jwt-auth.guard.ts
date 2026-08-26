import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { StaffUser } from '../../modules/staff/staff-user.entity';
import { ALLOW_TEMP_PASSWORD_KEY } from '../decorators/allow-temp-password.decorator';
import type { AuthUser } from '../decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

export interface AccessTokenPayload {
  sub: string;
  typ: 'access';
}

/**
 * Access токеныг шалгаад ажилтныг `req.user`-т тавина.
 *
 * Токен зөв байхад ажилтныг DB-ээс УНШИНА — payload дээрх мэдээлэлд
 * итгэхгүй. Ингэснээр:
 *   • Идэвхгүй болгосон ажилтан ТЭР ДАРУЙД хаагдана (токен дуусахыг хүлээхгүй)
 *   • Дүр буурсан бол шууд хүчинтэй
 * Ажилтны тоо цөөн (нэг фитнес) тул нэмэлт нэг PK хайлт үл мэдэгдэх зардал.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(StaffUser)
    private readonly staff: Repository<StaffUser>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Нэвтрэх шаардлагатай');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(
        header.slice(7).trim(),
        { secret: this.config.getOrThrow<string>('jwt.secret') },
      );
    } catch {
      throw new UnauthorizedException('Токен хүчингүй эсвэл хугацаа дууссан');
    }
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Токены төрөл буруу');
    }

    const user = await this.staff.findOne({ where: { id: payload.sub } });
    if (!user || !user.active) {
      throw new UnauthorizedException('Хэрэглэгч олдсонгүй эсвэл идэвхгүй');
    }

    // Түр нууц үгтэй бол солих хүртэл бусад бүх зам хаалттай.
    if (user.mustChangePassword) {
      const allowed = this.reflector.getAllAndOverride<boolean>(
        ALLOW_TEMP_PASSWORD_KEY,
        [ctx.getHandler(), ctx.getClass()],
      );
      if (!allowed) {
        throw new ForbiddenException('Эхлээд нууц үгээ солино уу');
      }
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    };
    return true;
  }
}
