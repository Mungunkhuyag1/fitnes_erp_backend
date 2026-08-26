import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AllowTempPassword } from '../../common/decorators/allow-temp-password.decorator';
import {
  CurrentUser,
  type AuthUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  LoginDto,
  RefreshDto,
  UpdateProfileDto,
} from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  // Нууц үг таах оролдлогыг хязгаарлана — IP-д 1 минутад 10.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Нэвтрэх' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, this.ctx(req));
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Токен шинэчлэх (хуучин нь хүчингүй болно)' })
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, this.ctx(req));
  }

  @Public()
  @Post('logout')
  @ApiOperation({ summary: 'Гарах — refresh токеныг хүчингүй болгоно' })
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
    return { ok: true };
  }

  @ApiBearerAuth('access-token')
  @AllowTempPassword()
  @Get('me')
  @ApiOperation({ summary: 'Одоогийн ажилтан' })
  // JWT доторх агшин зуурын хуулбарыг биш, САНГААС уншина: нэр/зураг
  // солигдоход токен дахин олгогдохгүй тул хуучин утга үлдэх байсан.
  me(@CurrentUser('id') userId: string) {
    return this.auth.profile(userId);
  }

  @ApiBearerAuth('access-token')
  @Patch('me')
  @ApiOperation({ summary: 'Өөрийн нэр, зургийг засах' })
  updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(userId, dto);
  }

  @ApiBearerAuth('access-token')
  @AllowTempPassword()
  @Post('change-password')
  @ApiOperation({ summary: 'Нууц үг солих (бүх сесс тасарна)' })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.auth.changePassword(userId, dto.currentPassword, dto.newPassword);
    return { ok: true, message: 'Нууц үг солигдлоо. Дахин нэвтэрнэ үү.' };
  }

  private ctx(req: Request) {
    return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
  }
}
