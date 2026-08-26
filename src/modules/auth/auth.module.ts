import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffUser } from '../staff/staff-user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshToken } from './refresh-token.entity';

/**
 * Global — `JwtAuthGuard` нь `JwtService` ба `StaffUser` repository-г глобал
 * guard-аас ашигладаг тул хаанаас ч хүртээмжтэй байх шаардлагатай.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([StaffUser, RefreshToken]),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, JwtModule, TypeOrmModule],
})
export class AuthModule {}
