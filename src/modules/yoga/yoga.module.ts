import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member } from '../member/member.entity';
import { YogaAttendance } from './yoga-attendance.entity';
import { YogaCourse } from './yoga-course.entity';
import { YogaEnrollment } from './yoga-enrollment.entity';
import { YogaController } from './yoga.controller';
import { YogaService } from './yoga.service';

/**
 * Йог — заалны бүртгэлээс ТУСДАА.
 *
 * ⚠ `Member`-ыг зөвхөн НЭР авахад уншина. Гишүүнчлэл, outbox-той
 * холбогдохгүй. Терминалтай ГАНЦ холбоос нь ирц бүртгэхэд хаалга
 * нээх (`DEVICE_GATEWAY` нь `@Global` модулиас ирнэ).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([YogaCourse, YogaEnrollment, YogaAttendance, Member]),
  ],
  controllers: [YogaController],
  providers: [YogaService],
  exports: [YogaService],
})
export class YogaModule {}
