import { Rule, RuleType } from '@midwayjs/validate';

export class AdminVoiceClippingMaterialDTO {
  @Rule(RuleType.string().allow('').max(100).optional())
  id?: string;

  @Rule(RuleType.string().trim().min(1).max(200).optional())
  name?: string;

  @Rule(RuleType.string().trim().min(1).max(2000).required())
  objectKey: string;

  @Rule(RuleType.string().allow('').max(2000).optional())
  publicUrl?: string;

  @Rule(RuleType.number().optional())
  durationSeconds?: number;
}

export class AdminVoiceClippingDTO {
  @Rule(RuleType.string().trim().min(1).max(2000).required())
  userId: string;

  @Rule(
    RuleType.array()
      .items(RuleType.object())
      .min(1)
      .max(50)
      .required()
  )
  materials: AdminVoiceClippingMaterialDTO[];

  @Rule(RuleType.string().allow('').optional())
  mode?: string;
}
