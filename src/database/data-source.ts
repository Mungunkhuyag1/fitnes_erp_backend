import 'dotenv/config';
import { DataSource } from 'typeorm';
import { join } from 'path';

/**
 * TypeORM CLI-д зориулсан DataSource (migration үүсгэх/ажиллуулах).
 * Runtime дэх холболтыг `app.module.ts` тусад нь тохируулна.
 *
 * `synchronize` НЭГ Ч ҮЕД `true` болохгүй — схемийн бүх өөрчлөлт migration-аар.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === 'false'
      ? false
      : { rejectUnauthorized: false },
  entities: [join(__dirname, '..', 'modules', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
});
