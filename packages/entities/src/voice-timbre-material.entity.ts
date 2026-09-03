import { Column, Entity, Index } from "typeorm";
import { BaseEntity, MongoObjectId, TableName } from "./base";

@Index(["userId", "objectKey"], { unique: true, background: true })
@Index(["userId", "createdAt"], { background: true })
@Entity(TableName.voice_timbre_material)
export class VoiceTimbreMaterialEntity extends BaseEntity {
  @Column()
  userId?: MongoObjectId;

  @Column()
  name: string;

  @Column()
  objectKey: string;

  @Column()
  publicUrl?: string;

  @Column()
  sizeBytes?: number;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
