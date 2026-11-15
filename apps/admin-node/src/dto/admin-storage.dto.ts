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

export class DownloadCosObjectQueryDTO {
  @Rule(RuleType.string().trim().min(1).max(1000).required())
  objectKey: string;

  @Rule(RuleType.string().trim().max(200).optional())
  fileName?: string;
}
