import { Column, Entity } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

export const FREE_CHAT_AGENT_LEDGER_POLICY_VERSION = "first_three_created_v1";

export interface FreeChatAgentSlot {
  agentId: MongoObjectId;
  createdAt: Date;
}

/**
 * One durable slot ledger per agent creator. Assigned slots remain after an
 * agent is deleted, while an earlier-created concurrent agent may replace a
 * later slot so the final order stays deterministic.
 * The document id is deliberately the same ObjectId as userId, so Mongo's
 * built-in _id uniqueness protects concurrent first writes without an index
 * migration.
 */
@Entity(TableName.free_chat_agent_ledger)
export class FreeChatAgentLedgerEntity extends BaseEntity {
  @Column()
  userId: MongoObjectId;

  @Column()
  slots: FreeChatAgentSlot[];

  @Column()
  policyVersion: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
