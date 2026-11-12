import { Rule, RuleType } from '@midwayjs/validate';

export class ListUserInterviewsQueryDTO {
  @Rule(RuleType.string().trim().min(1).max(64).required())
  userId: string;
}

export class CreateUserInterviewDTO {
  @Rule(RuleType.string().trim().min(1).max(64).required())
  userId: string;

  @Rule(RuleType.string().trim().max(120).optional())
  title?: string;

  @Rule(RuleType.string().trim().max(20).optional())
  interviewDate?: string;

  @Rule(RuleType.string().trim().min(1).max(300000).required())
  transcript: string;

  @Rule(RuleType.string().trim().max(200).optional())
  transcriptFileName?: string;
}

export class UpdateUserInterviewDTO {
  @Rule(RuleType.string().trim().max(120).optional())
  title?: string;

  @Rule(RuleType.string().trim().max(20).optional())
  interviewDate?: string;

  @Rule(RuleType.string().trim().min(1).max(300000).optional())
  transcript?: string;

  @Rule(RuleType.array().items(RuleType.object()).max(60).optional())
  answers?: Array<Record<string, unknown>>;
}

export class ExtractInterviewDocxDTO {
  @Rule(RuleType.string().trim().max(200).optional())
  fileName?: string;

  @Rule(RuleType.string().min(1).required())
  base64: string;
}

export class ExtractInterviewPdfDTO {
  @Rule(RuleType.string().trim().max(200).optional())
  fileName?: string;

  @Rule(RuleType.string().min(1).required())
  base64: string;
}
