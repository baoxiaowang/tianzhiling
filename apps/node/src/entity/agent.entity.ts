import { Entity, Column } from 'typeorm';
import { BaseEntity, MongoObjectId, TableName } from './base'

export enum AgentSex {
  woman = 0,
  man = 1,
}

@Entity(TableName.agent)
export class AgentEntity extends BaseEntity {
  @Column()
  createdUserId: MongoObjectId; // 归属哪个用户

  @Column()
  name: string; // 代理名称

  @Column()
  avatar: string; // 代理头像


  @Column()
  sex: AgentSex; // 性别


  // agent 称呼我为
  @Column()
  agentCallMe?: string;

  // 我称呼 agent 为
  @Column()
  iCallAgent?: string;

  @Column()
  birthday?: Date; // 生日

  @Column()
  deathDate?: Date; //逝世日期
  

  @Column()
  description: string;

  @Column()
  status: number;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
