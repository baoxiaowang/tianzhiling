import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base';

/**
 * 客户端支付拉起失败上报（iOS/安卓、虚拟支付/普通支付）。
 * 用于定位「点支付没反应」类问题：客户端把 errMsg、平台、微信版本、订单号报上来。
 */
@Index(['createdAt'], { background: true })
@Entity(TableName.client_pay_failure_log)
export class ClientPayFailureLogEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  orderId?: MongoObjectId;

  @Column()
  orderNo?: string;

  /** 拉起支付阶段：create_order / request_payment / virtual_payment / unknown */
  @Column()
  stage: string;

  /** ios / android / devtools / unknown */
  @Column()
  platform: string;

  @Column()
  channel?: string;

  @Column()
  errMsg?: string;

  @Column()
  sdkVersion?: string;

  @Column()
  weappVersion?: string;

  @Column()
  extra?: Record<string, unknown>;

  @Column()
  createdAt: Date;
}
