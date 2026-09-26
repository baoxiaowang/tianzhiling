import { Rule, RuleType } from '@midwayjs/validate';

/**
 * 腾讯云声音复刻（一句话版）管理员端点 DTO。
 * 凭证只在服务端，前端只传 audioKey / textId / voiceName / gender 等业务字段。
 */

export class DetectTencentVrsQualityDTO {
  /** COS 上训练音频的 objectKey（由前端先上传到 COS 后得到）。 */
  @Rule(RuleType.string().trim().min(1).max(1000).required())
  audioKey: string;

  /** GetTrainingText 返回的 TextId，音频必须按该文本朗读。 */
  @Rule(RuleType.string().trim().min(1).max(64).required())
  textId: string;
}

export class TrainTencentVrsDTO {
  /** 音质检测通过后腾讯云返回的 AudioId。 */
  @Rule(RuleType.string().trim().min(1).max(128).required())
  audioId: string;

  /** 音色名称。 */
  @Rule(RuleType.string().trim().min(1).max(60).required())
  voiceName: string;

  /** 性别：1=男，2=女（腾讯云要求 int64，不能传字符串）。 */
  @Rule(RuleType.number().valid(1, 2).required())
  voiceGender: number;

  /** GetTrainingText 返回的 TextId，用于留档。 */
  @Rule(RuleType.string().trim().min(1).max(64).required())
  textId: string;

  /** 归属用户 ID（Mongo ObjectId 字符串）。 */
  @Rule(RuleType.string().trim().min(1).max(64).required())
  userId: string;

  /** 检测时使用的 COS audioKey，用于在本地音色记录中留档训练音频。 */
  @Rule(RuleType.string().trim().min(1).max(1000).required())
  audioKey: string;

  @Rule(RuleType.string().allow('').trim().max(500).optional())
  voiceDescription?: string;

  @Rule(RuleType.string().allow('').max(1000).optional())
  remark?: string;
}

export class AuditionTencentVrsDTO {
  @Rule(RuleType.string().trim().min(1).max(64).required())
  timbreId: string;

  /** 试听文本，<=150 字。 */
  @Rule(RuleType.string().trim().min(1).max(150).required())
  text: string;
}
