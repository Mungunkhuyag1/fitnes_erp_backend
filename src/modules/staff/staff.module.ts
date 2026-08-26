import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffController } from './staff.controller';
import { StaffPublicController } from './staff-public.controller';
import { StaffService } from './staff.service';
import { PasswordResetRequest } from './password-reset-request.entity';
import { StaffUser } from './staff-user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([StaffUser, PasswordResetRequest])],
  controllers: [StaffController, StaffPublicController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}
