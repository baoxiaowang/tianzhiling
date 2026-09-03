import { Rule, RuleType } from '@midwayjs/validate';

export class CreateAdminVoiceTimbreMaterialDTO {
  @Rule(RuleType.string().trim().min(1).max(2000).required())
  userId: string;

  @Rule(RuleType.string().trim().min(1).max(200).required())
  name: string;

  @Rule(RuleType.string().trim().min(1).max(2000).required())
  objectKey: string;

  @Rule(RuleType.string().allow('').max(2000).optional())
  publicUrl?: string;
}

export class ListAdminVoiceTimbreMaterialsQueryDTO {
  @Rule(RuleType.string().trim().min(1).max(2000).required())
  userId: string;
}
