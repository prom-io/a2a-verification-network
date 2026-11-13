import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WebhookHttpClient } from './webhook-http.client';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookDelivery])],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookHttpClient],
  exports: [WebhooksService],
})
export class WebhooksModule {}
