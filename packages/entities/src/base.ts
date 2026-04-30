import { ObjectIdColumn } from 'typeorm';
import { ObjectId as MongoObjectId } from 'mongodb';

export { MongoObjectId };

export enum TableName {
  user = 'user',
  user_account = 'user_account',
  admin_user = 'admin_user',
  admin_account = 'admin_account',
  agent = 'agent',
  agent_sub = 'agent_sub',
  conversation = 'conversation',
  message = 'message',
  post = 'post',
  post_comment = 'post_comment',
  post_comment_notification = 'post_comment_notification',
  vip_plan = 'vip_plan',
  order = 'order',
  user_membership = 'user_membership',
  user_entitlement = 'user_entitlement',
  coupon_ledger = 'coupon_ledger',
}

export class BaseEntity {
  @ObjectIdColumn()
  id!: MongoObjectId;
}
