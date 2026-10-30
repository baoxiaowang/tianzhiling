import { Inject, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { RedisService } from '@midwayjs/redis';
import { MongoRepository } from 'typeorm';
import {
  MongoObjectId,
  UserKnownPersonEntity,
  UserKnownPersonStatus,
} from '@tzl/entities';

export interface PersonAddressCorrection {
  oldName: string;
  newName: string;
}

const NAME = '[\\u4e00-\\u9fa5A-Za-z·]{1,12}';
const INVALID_NAME = /^(?:我|你|他|她|它|我们|你们|他们|她们|这个|那个|什么|谁|哪个|不是|没有|叫|是)$/;
const BAN_TTL_SECONDS = 180 * 24 * 60 * 60;

export function extractPersonAddressCorrection(
  sourceText: string
): PersonAddressCorrection | null {
  const text = (sourceText || '').replace(/\s+/g, '').trim();
  if (!text) return null;

  const patterns: Array<{ regex: RegExp; oldIndex: number; newIndex: number }> = [
    {
      regex: new RegExp(
        `(?:不是|别叫|不要叫|不叫)(${NAME})[，,、]?(?:是|叫|应该是|要叫)(${NAME})`
      ),
      oldIndex: 1,
      newIndex: 2,
    },
    {
      regex: new RegExp(
        `(${NAME})[，,](?:不是|别叫|不要叫)(${NAME})`
      ),
      oldIndex: 2,
      newIndex: 1,
    },
  ];

  for (const pattern of patterns) {
    const match = pattern.regex.exec(text);
    if (!match) continue;
    const oldName = normalizeName(match[pattern.oldIndex]);
    const newName = normalizeName(match[pattern.newIndex]);
    if (
      !oldName ||
      !newName ||
      oldName === newName ||
      INVALID_NAME.test(oldName) ||
      INVALID_NAME.test(newName)
    ) {
      continue;
    }
    return { oldName, newName };
  }
  return null;
}

function normalizeName(value?: string): string {
  return (value || '').replace(/[，,。！？!?；;：:、\s"'“”‘’]/g, '').trim();
}

@Provide()
export class PersonAddressService {
  @Logger()
  logger: ILogger;

  @Inject()
  redisService: RedisService;

  @InjectEntityModel(UserKnownPersonEntity)
  knownPersonModel: MongoRepository<UserKnownPersonEntity>;

  async applyCorrectionFromUserText(options: {
    userId: MongoObjectId | string;
    text: string;
  }): Promise<boolean> {
    const correction = extractPersonAddressCorrection(options.text);
    if (!correction) return false;

    const userId =
      options.userId instanceof MongoObjectId
        ? options.userId
        : new MongoObjectId(String(options.userId));
    const people = await this.knownPersonModel.find({
      where: {
        userId,
        status: UserKnownPersonStatus.active,
      } as never,
    });
    let target = people.find(person => {
      const names = [
        person.realName,
        person.preferredName,
        ...(person.aliases || []),
      ].filter(Boolean) as string[];
      return names.some(name => normalizeName(name) === correction.oldName);
    });
    if (!target) {
      // 旧变体不一定作为 alias 保存；先从 variant 映射找它对应的确认名字，
      // 再定位人物。这样“不是小蹦蛋儿，是小蹦得儿”仍然能修到正确人物。
      const bans = await this.loadBans(userId);
      const canonical = bans.get(correction.oldName);
      if (canonical) {
        target = people.find(person => {
          const names = [
            person.realName,
            person.preferredName,
            ...(person.aliases || []),
          ].filter(Boolean) as string[];
          return names.some(name => normalizeName(name) === normalizeName(canonical));
        });
      }
    }
    if (!target) {
      target = people.find(person =>
        Boolean(person.sourceText?.includes(correction.oldName))
      );
    }
    if (!target) return false;

    // 只废弃“被纠正的那个旧写法”，不要把它以外的有效昵称一起清掉。
    // 例：孩子有 preferred=小蹦得儿、allowed=小朵朵；纠正“小蹦蛋儿”时，
    // 只 ban 小蹦蛋儿，小朵朵必须保留。
    const normalizedOld = normalizeName(correction.oldName);
    const oldVariants = Array.from(
      new Set(
        [target.realName, target.preferredName, ...(target.aliases || [])]
          .map(name => normalizeName(name))
          .filter(name => name && name === normalizedOld)
          .concat(normalizedOld)
      )
    ).filter(name => name !== correction.newName);

    target.preferredName = correction.newName;
    if (!target.realName || normalizeName(target.realName) === normalizedOld) {
      target.realName = correction.newName;
    }
    target.aliases = (target.aliases || []).filter(
      name => normalizeName(name) !== normalizedOld
    );
    target.updatedAt = new Date();
    await this.knownPersonModel.save(target);

    await this.addBans(userId, oldVariants, correction.newName);

    this.logger?.info?.(
      '[person-address] correction applied, userId=%s old=%s new=%s personId=%s',
      String(userId),
      oldVariants.join('|'),
      correction.newName,
      String(target.id)
    );
    return true;
  }

  async normalizeText(options: {
    userId: MongoObjectId | string;
    text: string;
  }): Promise<{ text: string; replaced: string[] }> {
    const text = options.text || '';
    if (!text) return { text, replaced: [] };
    const bans = await this.loadBans(options.userId);
    if (!bans.size) return { text, replaced: [] };
    const replaced: string[] = [];
    let normalized = text;
    for (const [variant, canonical] of [...bans.entries()].sort(
      (left, right) => right[0].length - left[0].length
    )) {
      if (!variant || variant === canonical || !normalized.includes(variant)) {
        continue;
      }
      normalized = normalized.split(variant).join(canonical);
      replaced.push(variant);
    }
    if (replaced.length) {
      this.logger?.info?.(
        '[person-address] normalized names, userId=%s variants=%s',
        String(options.userId),
        replaced.join('|')
      );
    }
    return { text: normalized, replaced };
  }

  async addBans(
    userId: MongoObjectId | string,
    variants: string[],
    canonical: string
  ): Promise<void> {
    if (!this.redisService) return;
    const key = this.banKey(userId);
    for (const variant of variants) {
      if (!variant || variant === canonical) continue;
      await this.redisService.hset(key, variant, canonical);
    }
    await this.redisService.expire(key, BAN_TTL_SECONDS);
  }

  private async loadBans(
    userId: MongoObjectId | string
  ): Promise<Map<string, string>> {
    if (!this.redisService) return new Map();
    try {
      const raw = await this.redisService.hgetall(this.banKey(userId));
      return new Map(Object.entries(raw || {}));
    } catch {
      return new Map();
    }
  }

  private banKey(userId: MongoObjectId | string): string {
    return `person-address:${String(userId)}:bans`;
  }


}
