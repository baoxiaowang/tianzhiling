import { Inject } from '@midwayjs/core';
import { IProcessor, Processor } from '@midwayjs/bullmq';
import {
  ORDER_PAYMENT_EXPIRE_QUEUE,
  OrderPaymentExpireJobData,
  OrderService,
} from '../service/order.service';

@Processor(ORDER_PAYMENT_EXPIRE_QUEUE)
export class OrderPaymentExpireProcessor implements IProcessor {
  @Inject()
  orderService: OrderService;

  async execute(data: OrderPaymentExpireJobData): Promise<void> {
    await this.orderService.processPaymentExpireJob(data);
  }
}
