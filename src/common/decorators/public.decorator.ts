import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Нэвтрэлт шаардахгүй endpoint (`/public/*`, `/webhooks/*`, `/health`). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
