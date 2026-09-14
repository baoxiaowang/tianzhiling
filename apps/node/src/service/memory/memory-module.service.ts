import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { EVENT_MEMORY_ENGINE, MemoryEventEngine } from './memory-event.engine';
import {
  LEGACY_MEMORY_ENGINE,
  MemoryLegacyEngine,
} from './memory-legacy.engine';
import type {
  MemoryCapabilities,
  MemoryIngestRequest,
  MemoryIngestResult,
  MemoryMaintenanceAction,
  MemoryMaintenanceResult,
  MemoryModule,
  MemoryOpenItemsRequest,
  MemoryOpenItemsResult,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryShadowDiagnostics,
  MemorySwitchConfig,
  MemorySwitchMode,
  MemoryUpdateOpenItemRequest,
  MemoryUpdateOpenItemResult,
} from './memory-module.types';

export interface MemoryModuleSelection {
  mode: MemorySwitchMode;
  /** 生效引擎：未了结清单、写入、维护走它。 */
  primary: string;
  /** 检索引擎：默认仍旧是旧引擎，避免开启新模块时顺带换掉召回质量。 */
  recallEngine: string;
  shadow?: string;
  /** 配置里声明的生效名单，便于诊断"为什么这轮没走新引擎"。 */
  scopedUserIds: number;
}

/**
 * 记忆模块门面：上层唯一入口。
 * - off：只用旧引擎（行为与今天完全一致）；
 * - shadow：新引擎照跑，只记录诊断，不注入；
 * - active：注入 primary 引擎的结果。
 * 引擎失败一律降级为"这轮没有记忆"，绝不影响回复。
 */
@Provide()
export class MemoryModuleService {
  @Logger()
  logger: ILogger;

  @Inject()
  legacyEngine: MemoryLegacyEngine;

  @Inject()
  eventEngine: MemoryEventEngine;

  capabilities(engineName?: string): MemoryCapabilities {
    const engine = this.resolveEngine(
      engineName || this.resolveConfig().primary
    );
    return (engine || this.legacyEngine).capabilities();
  }

  describeSelection(userId?: string): MemoryModuleSelection {
    const config = this.resolveConfig();
    const scoped = this.inScope(config, userId);
    return {
      mode: scoped ? config.mode : 'off',
      primary: config.primary,
      recallEngine: config.recallEngine,
      ...(config.shadow ? { shadow: config.shadow } : {}),
      scopedUserIds: config.scope.userIds.length,
    };
  }

  async ingest(request: MemoryIngestRequest): Promise<MemoryIngestResult> {
    const selection = this.describeSelection(request.userId);
    if (selection.mode === 'off') {
      return { status: 'skipped', reason: 'module_off' };
    }

    const engines = this.uniqueEngines([
      this.resolveEngine(selection.primary),
      selection.mode === 'shadow'
        ? this.resolveEngine(selection.shadow)
        : undefined,
    ]);
    const groupIds: string[] = [];
    let status: MemoryIngestResult['status'] = 'skipped';
    for (const engine of engines) {
      try {
        const result = await engine.ingest(request);
        if (result.status === 'accepted') status = 'accepted';
        if (result.status === 'failed' && status !== 'accepted')
          status = 'failed';
        for (const id of result.groupIds || []) {
          if (groupIds.indexOf(id) === -1) groupIds.push(id);
        }
      } catch (error) {
        this.logger?.warn?.(
          '[memory] ingest failed, engine=%s userId=%s reason=%s',
          engine.capabilities().engine,
          request.userId,
          describeError(error)
        );
        if (status !== 'accepted') status = 'failed';
      }
    }
    return { status, groupIds };
  }

  async recall(request: MemoryRecallRequest): Promise<MemoryRecallResult> {
    const selection = this.describeSelection(request.userId);
    if (selection.mode === 'off') {
      return {
        evidence: [],
        status: 'skipped',
        diagnostics: {
          engine: LEGACY_MEMORY_ENGINE,
          mode: 'off',
          candidateCount: 0,
          selectedCount: 0,
          skipReason: 'module_off',
        },
      };
    }

    // 检索单独走 recallEngine：默认旧引擎，开启新模块不会顺带把召回换成窄得多的事件引擎。
    const primary =
      this.resolveEngine(selection.recallEngine) || this.legacyEngine;
    const shadow =
      selection.mode === 'shadow'
        ? this.resolveEngine(selection.shadow)
        : undefined;

    const [primaryResult, shadowResult] = await Promise.all([
      this.recallOnce(primary, { ...request }, selection.mode),
      shadow
        ? this.recallOnce(shadow, { ...request }, 'active')
        : Promise.resolve(undefined),
    ]);

    return {
      ...primaryResult,
      diagnostics: { ...primaryResult.diagnostics, mode: selection.mode },
      ...(shadowResult ? { shadow: toShadowDiagnostics(shadowResult) } : {}),
    };
  }

  async listOpenItems(
    request: MemoryOpenItemsRequest
  ): Promise<MemoryOpenItemsResult> {
    const selection = this.describeSelection(request.userId);
    if (selection.mode === 'off') {
      return {
        items: [],
        status: 'empty',
        diagnostics: { engine: selection.primary, total: 0 },
      };
    }
    const engine = this.resolveEngine(selection.primary);
    if (!engine) {
      return {
        items: [],
        status: 'failed',
        diagnostics: {
          engine: selection.primary,
          total: 0,
          errorCode: 'engine_unavailable',
        },
      };
    }
    try {
      return await engine.listOpenItems(request);
    } catch (error) {
      return {
        items: [],
        status: 'failed',
        diagnostics: {
          engine: selection.primary,
          total: 0,
          errorCode: describeError(error),
        },
      };
    }
  }

  async updateOpenItem(
    request: MemoryUpdateOpenItemRequest
  ): Promise<MemoryUpdateOpenItemResult> {
    const selection = this.describeSelection(request.userId);
    if (selection.mode === 'off') return { status: 'not_found' };
    const engine = this.resolveEngine(selection.primary);
    if (!engine) return { status: 'failed' };
    try {
      return await engine.updateOpenItem(request);
    } catch (error) {
      this.logger?.warn?.(
        '[memory] updateOpenItem failed, engine=%s reason=%s',
        selection.primary,
        describeError(error)
      );
      return { status: 'failed' };
    }
  }

  async maintain(
    request: MemoryMaintenanceAction
  ): Promise<MemoryMaintenanceResult> {
    const userId = 'userId' in request ? request.userId : undefined;
    const selection = this.describeSelection(userId);
    const engine = this.resolveEngine(selection.primary);
    if (!engine)
      return { status: 'failed', detail: { reason: 'engine_unavailable' } };
    return engine.maintain(request);
  }

  private async recallOnce(
    engine: MemoryModule,
    request: MemoryRecallRequest,
    mode: MemorySwitchMode
  ): Promise<MemoryRecallResult> {
    const startedAt = Date.now();
    try {
      const result = await engine.recall(request);
      return {
        ...result,
        diagnostics: {
          ...result.diagnostics,
          mode,
          elapsedMs: result.diagnostics.elapsedMs ?? Date.now() - startedAt,
        },
      };
    } catch (error) {
      this.logger?.warn?.(
        '[memory] recall failed, engine=%s userId=%s reason=%s',
        engine.capabilities().engine,
        request.userId,
        describeError(error)
      );
      return {
        evidence: [],
        status: 'failed',
        diagnostics: {
          engine: engine.capabilities().engine,
          mode,
          candidateCount: 0,
          selectedCount: 0,
          errorCode: describeError(error),
          elapsedMs: Date.now() - startedAt,
        },
      };
    }
  }

  private resolveEngine(name?: string): MemoryModule | undefined {
    if (name === LEGACY_MEMORY_ENGINE) return this.legacyEngine;
    if (name === EVENT_MEMORY_ENGINE) return this.eventEngine;
    return undefined;
  }

  private uniqueEngines(
    engines: Array<MemoryModule | undefined>
  ): MemoryModule[] {
    const result: MemoryModule[] = [];
    for (const engine of engines) {
      if (!engine) continue;
      if (result.indexOf(engine) === -1) result.push(engine);
    }
    // 旧引擎的写入是 no-op，但保留它可让"影子 + 旧引擎为 primary"时也走一遍统一路径。
    return result;
  }

  private resolveConfig(): MemorySwitchConfig {
    const mode = readMode(process.env.NODE_MEMORY_MODULE_MODE);
    const primary = readEngineName(
      process.env.NODE_MEMORY_MODULE_PRIMARY,
      LEGACY_MEMORY_ENGINE
    );
    const shadow = readEngineName(
      process.env.NODE_MEMORY_MODULE_SHADOW,
      EVENT_MEMORY_ENGINE
    );
    return {
      mode,
      primary,
      ...(shadow && shadow !== primary ? { shadow } : {}),
      recallEngine: readEngineName(
        process.env.NODE_MEMORY_MODULE_RECALL_ENGINE,
        LEGACY_MEMORY_ENGINE
      ),
      scope: {
        all:
          process.env.NODE_MEMORY_MODULE_SCOPE === 'all' &&
          readMode(process.env.NODE_MEMORY_MODULE_MODE) !== 'off',
        userIds: (process.env.NODE_MEMORY_MODULE_USER_IDS || '')
          .split(',')
          .map(value => value.trim().toLowerCase())
          .filter(value => /^[a-f0-9]{24}$/.test(value)),
      },
      policy: {
        injectLimit: 1,
        minEvidenceCharacters: 6,
        requireRetrievalKey: true,
        personAlignment: true,
        dropEmotional: true,
        dropQuestion: true,
      },
    };
  }

  private inScope(config: MemorySwitchConfig, userId?: string): boolean {
    if (config.mode === 'off') return false;
    // 全量开启：NODE_MEMORY_MODULE_SCOPE=all 时不再看名单（真实流量验证用）。
    if (config.scope.all) return true;
    const id = String(userId || '').toLowerCase();
    if (!/^[a-f0-9]{24}$/.test(id)) return false;
    // 空名单 = 关闭：绝不因为配置缺失而对全部用户开启。
    return config.scope.userIds.indexOf(id) !== -1;
  }
}

function toShadowDiagnostics(
  result: MemoryRecallResult
): MemoryShadowDiagnostics {
  return {
    engine: result.diagnostics.engine,
    status: result.status,
    candidateCount: result.diagnostics.candidateCount,
    selectedCount: result.diagnostics.selectedCount,
    evidenceIds: result.evidence.map(item => item.id),
    evidencePreviews: result.evidence
      .slice(0, 3)
      .map(item => item.text.slice(0, 40)),
    ...(result.diagnostics.errorCode
      ? { errorCode: result.diagnostics.errorCode }
      : {}),
    ...(typeof result.diagnostics.elapsedMs === 'number'
      ? { elapsedMs: result.diagnostics.elapsedMs }
      : {}),
  };
}

function readMode(value?: string): MemorySwitchMode {
  return value === 'shadow' || value === 'active' ? value : 'off';
}

function readEngineName(value: string | undefined, fallback: string): string {
  const name = (value || '').trim();
  if (name === LEGACY_MEMORY_ENGINE || name === EVENT_MEMORY_ENGINE)
    return name;
  return fallback;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
