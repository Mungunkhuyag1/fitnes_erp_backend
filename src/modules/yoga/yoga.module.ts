import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Member } from '../member/member.entity';
import { YogaBooking } from './yoga-booking.entity';
import { YogaClass } from './yoga-class.entity';
import { YogaController } from './yoga.controller';
import { YogaService } from './yoga.service';

/**
 * Йог — заалны бүртгэлээс ТУСДАА.
 *
 * ⚠ `Member`-ыг зөвхөн НЭР авахад уншина. Гишүүнчлэл, терминал,
 * outbox аль нэгтэй нь холбогдохгүй: хаалгыг админ өөрөө нээдэг.
 */
@Module({
  imports: [TypeOrmModule.forFeature([YogaClass, YogaBooking, Member])],
  controllers: [YogaController],
  providers: [YogaService],
  exports: [YogaService],
})
export class YogaModule {}
