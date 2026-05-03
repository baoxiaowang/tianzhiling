import { Rule, RuleType } from '@midwayjs/validate';

export class CreateAdminCosSignedUploadDTO {
  @Rule(RuleType.string().trim().min(1).max(255).required())
  fileName: string;

  @Rule(RuleType.string().allow('').max(120).optional())
  folder?: string;

  @Rule(RuleType.string().allow('').max(120).optional())
  contentType?: string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  expiresInSeconds?: number | string;
}
