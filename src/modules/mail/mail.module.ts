import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxModule } from '../outbox/outbox.module';
import { DigestService } from './digest.service';
import { MailController } from './mail.controller';
import { EmailLog, NotificationRecipient } from './mail.entity';
import { MailProvider } from './mail.provider';
import { MailService } from './mail.service';
import { MailRecipientService } from './recipient.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([NotificationRecipient, EmailLog]),
    OutboxModule,
  ],
  controllers: [MailController],
  providers: [MailProvider, MailService, MailRecipientService, DigestService],
  exports: [MailService],
})
export class MailModule {}
