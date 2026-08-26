import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

export const ROLES_KEY = 'roles';
/** Шаардлагатай хамгийн доод үүрэг. Дээд үүрэг автоматаар нэвтэрнэ. */
export const Roles = (min: Role) => SetMetadata(ROLES_KEY, min);
