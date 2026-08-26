import { SetMetadata } from '@nestjs/common';

export const ALLOW_TEMP_PASSWORD_KEY = 'allowTempPassword';
/**
 * Түр нууц үгтэй (`mustChangePassword`) хэрэглэгчид ч зөвшөөрөгдөх endpoint.
 * Зөвхөн `/auth/me`, `/auth/change-password`, `/auth/logout` дээр.
 */
export const AllowTempPassword = () => SetMetadata(ALLOW_TEMP_PASSWORD_KEY, true);
