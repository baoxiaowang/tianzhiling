import { ObjectIdColumn } from 'typeorm';
import { ObjectId as MongoObjectId } from 'mongodb';

export { MongoObjectId };

export enum TableName {
  // 用户
  user = 'user',
  user_account = 'user_account', // 用户账号

  // agent
  agent = 'agent',
  agent_sub = 'agent_sub', // 子代理关系

  // 对话
  conversation = 'conversation', // 对话
  message = 'message', // 消息

  // post 动态
  post = 'post',
  post_comment = 'post_comment',
  post_comment_notification = 'post_comment_notification',
}

export class BaseEntity {
  @ObjectIdColumn()
  id!: MongoObjectId;
}
