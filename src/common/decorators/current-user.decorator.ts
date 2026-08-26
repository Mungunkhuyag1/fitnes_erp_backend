import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { Role } from '../enums/role.enum';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Профайл зураг — `data:` URL эсвэл `null`. */
  avatar?: string | null;
  mustChangePassword: boolean;
}

/** Нэвтэрсэн ажилтныг controller-т шууд авах. */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    return data && user ? user[data] : user;
  },
);
