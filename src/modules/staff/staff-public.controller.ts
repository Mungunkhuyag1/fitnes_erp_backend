import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ForgotPasswordDto } from './dto/staff.dto';
import { StaffService } from './staff.service';

/**
 * Нэвтрэхээс ӨМНӨ дуудагдах цорын ганц ажилтны endpoint.
 *
 * `StaffController` нь бүхэлдээ `@Roles(Role.ADMIN)`-той тул тусад нь
 * гаргав — нийтийн зам админы хамгаалалттай хэсэгт орооцолдох нь
 * дараа нь эрх шалгалт алдагдах эрсдэл үүсгэнэ.
 *
 * `AuthController` дээр биш байгаа шалтгаан: `AuthModule` → `StaffModule`
 * → `AuthModule` гэсэн ДУГУЙ ХАМААРАЛ үүснэ (`StaffService` нь
 * `AuthService`-ийг ашигладаг).
 */
@ApiTags('auth')
@Controller('auth')
export class StaffPublicController {
  constructor(private readonly staff: StaffService) {}

  @Public()
  @Post('forgot-password')
  // Хүсэлт бүр санд мөр үүсгэдэг тул хязгаарлана — эс бөгөөс дарааллыг
  // хогдуулж, админ жинхэнэ хүсэлтийг олохгүй болно.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Нууц үг сэргээх хүсэлт үлдээх',
    description:
      'Мэйл илгээхгүй — админ хүсэлтийг хараад түр нууц үг тавина. ' +
      'Хариу нь и-мэйл бүртгэлтэй эсэхээс ҮЛ ХАМААРНА.',
  })
  async forgot(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.staff.requestReset(dto.email, dto.note ?? null, req.ip ?? null);
    return {
      ok: true,
      message: 'Хүсэлт хүлээн авлаа. Админ түр нууц үг тавьж танд мэдэгдэнэ.',
    };
  }
}
