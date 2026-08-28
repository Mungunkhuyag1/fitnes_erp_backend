import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { configuration } from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { AuthModule } from './modules/auth/auth.module';
import { AccessModule } from './modules/access/access.module';
import { AuditModule } from './modules/audit/audit.module';
import { DeviceModule } from './modules/device/device.module';
import { HealthModule } from './modules/health/health.module';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { LockerModule } from './modules/locker/locker.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { MemberModule } from './modules/member/member.module';
import { MembershipModule } from './modules/membership/membership.module';
import { MailModule } from './modules/mail/mail.module';
import { OutboxModule } from './modules/outbox/outbox.module';
import { PackageModule } from './modules/package/package.module';
import { PublicModule } from './modules/public/public.module';
import { ReportModule } from './modules/report/report.module';
import { SettingsModule } from './modules/settings/settings.module';
import { StaffModule } from './modules/staff/staff.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('database.url'),
        ssl: config.get<boolean>('database.ssl')
          ? { rejectUnauthorized: false }
          : false,
        entities: [join(__dirname, 'modules', '**', '*.entity.{ts,js}')],
        // Схемийн өөрчлөлт ЗӨВХӨН migration-аар (docs/02 §12).
        synchronize: false,
        migrationsRun: false,
        logging: config.get<boolean>('database.logging'),
      }),
    }),

    // Cron: хугацаа дуусгах, сануулга, шөнийн тулгалт (docs/05 §4.3).
    ScheduleModule.forRoot(),

    // Ерөнхий хязгаар. `/public/*` дээр тусад нь чангатгана (docs/05 §3.7).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),

    AuthModule,
    SettingsModule,
    AuditModule,
    MailModule,
    OutboxModule,
    StaffModule,
    PackageModule,
    MemberModule,
    MembershipModule,
    AccessModule,
    LockerModule,
    InvoiceModule,
    LoyaltyModule,
    PublicModule,
    ReportModule,
    DeviceModule,
    HealthModule,
  ],
  providers: [
    // Дараалал чухал: эхлээд throttle (нэвтрэлт бүтэлгүйтсэн ч тоологдоно),
    // дараа нь нэвтрэлт (`req.user` тавина), эцэст нь дүр.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
