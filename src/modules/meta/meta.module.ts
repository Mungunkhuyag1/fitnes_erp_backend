import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetaConversation } from './meta-conversation.entity';
import { MetaMessage } from './meta-message.entity';
import { MetaPage } from './meta-page.entity';
import { MetaController } from './meta.controller';
import { MetaWebhookController } from './meta-webhook.controller';
import { MetaService } from './meta.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MetaPage, MetaConversation, MetaMessage]),
  ],
  controllers: [MetaController, MetaWebhookController],
  providers: [MetaService],
  exports: [MetaService],
})
export class MetaModule {}
