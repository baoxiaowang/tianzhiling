import { Column, Entity } from 'typeorm';
import { BaseEntity, TableName } from './base';

export enum VoiceTimbreProvider {
  minimax = 'minimax',
  qwen = 'qwen',
  doubao = 'doubao',
}

export enum VoiceTimbreStatus {
  creating = 'creating',
  active = 'active',
  failed = 'failed',
  disabled = 'disabled',
}

@Entity(TableName.voice_timbre)
export class VoiceTimbreEntity extends BaseEntity {
  @Column()
  name: string;

  @Column()
  provider: VoiceTimbreProvider;

  @Column()
  providerVoiceId: string;

  @Column()
  providerFileId?: string;

  @Column()
  audioObjectKey: string;

  @Column()
  audioUrl?: string;

  @Column()
  cloneLanguage: string;

  @Column()
  previewText?: string;

  @Column()
  previewModel?: string;

  @Column()
  previewAudioUrl?: string;

  @Column()
  status: VoiceTimbreStatus;

  @Column()
  errorCode?: string;

  @Column()
  errorMessage?: string;

  @Column()
  remark?: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
}
