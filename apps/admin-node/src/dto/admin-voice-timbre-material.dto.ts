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

export class SaveAdminVoiceTimbreReviewClipsDTO {
  @Rule(RuleType.array().items(RuleType.object()).max(100).required())
  clips: Array<Record<string, unknown>>;
}

export class RollbackAdminVoiceTimbreMaterialUploadDTO {
  @Rule(RuleType.string().trim().min(1).max(2000).required())
  objectKey: string;
}

export class AnalyzeAdminVoiceTimbreDTO {
  @Rule(
    RuleType.array()
      .items(RuleType.string().trim().min(1).max(2000))
      .min(1)
      .max(8)
      .required()
  )
  objectKeys: string[];

  @Rule(
    RuleType.array()
      .items(RuleType.string().allow('').max(300))
      .max(8)
      .optional()
  )
  transcripts?: string[];
}
