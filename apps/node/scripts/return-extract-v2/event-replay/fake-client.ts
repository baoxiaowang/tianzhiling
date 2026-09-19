/**
 * P02 本地原型：可注入的"预设响应"假客户端。
 *
 * 注意：这些预设响应是**测试刺激**，只用来驱动程序、验证回放与状态应用；
 * 它们不是参考答案，也不代表任何模型的语义能力。目标事件由客户端从
 * 输入快照里按状态片段定位（模拟"模型引用输入中已有的 eventId"）。
 */
import type { ChatClient } from '../request-boundary';
import { REPLAY_SCHEMA } from './protocol';

interface ScriptEvidence {
  messageId: string;
  quote: string;
}

export interface ScriptOp {
  opId: string;
  action: string;
  kind?: string | null;
  targetMatch?: string;
  restrictionMatch?: string;
  inheritsRestrictionMatch?: string;
  subject?: string | null;
  state?: string | null;
  details?: string[];
  evidence?: ScriptEvidence[];
  uncertainty?: string | null;
  reason: string;
  restrictionScope?: string | null;
  currentTurnIntent?: string | null;
  proactiveAllowed?: boolean | null;
  /** 首次看到就已完成时用的、经过校验的初始状态。 */
  initialStatus?: string | null;
  /** 故意给出非法目标，用于验证"错误目标可追踪、不被静默改成别的对象"。 */
  forceEventId?: string;
}

interface Script {
  operations: ScriptOp[];
  unresolved?: Array<{ messageIds: string[]; reason: string }>;
}

function findEventId(snapshot: any, match: string | undefined): string | null {
  if (!match) return null;
  const events: any[] = Array.isArray(snapshot?.events) ? snapshot.events : [];
  const hit = events.find(
    event =>
      String(event.state || '').includes(match) ||
      String(event.subject || '').includes(match)
  );
  return hit ? String(hit.eventId) : null;
}

function findRestrictionId(snapshot: any, match: string | undefined): string | null {
  if (!match) return null;
  const rows: any[] = Array.isArray(snapshot?.restrictions)
    ? snapshot.restrictions
    : [];
  const hit = rows.find(
    item => item.active && String(item.scope || '').includes(match)
  );
  return hit ? String(hit.restrictionId) : null;
}

export function buildScript(): Record<string, Script> {
  const scripts: Record<string, Script> = {};

  scripts['TR-03#1'] = {
    operations: [
      {
        opId: 'op-1',
        action: 'create',
        kind: 'background',
        subject: '我',
        state: '用户自述情绪持续困扰：每天很抑郁、容易急躁、情绪稳定不下来',
        evidence: [
          { messageId: '6a2997bbe0dede1ad806203d', quote: '我每天很抑郁' },
          { messageId: '6a2997c7e37e5187f659fcab', quote: '很容易一点事就急躁' },
          { messageId: '6a2997d8e0dede1ad8062040', quote: '情绪稳定不下来' },
        ],
        uncertainty: '是否就医、持续多久未知',
        reason: '保留自述强度，不扩为诊断',
        proactiveAllowed: false,
      },
      {
        opId: 'op-2',
        action: 'no_change',
        currentTurnIntent: '寒暄与呼应，不建立事件',
        evidence: [
          { messageId: '6a2997a8148962d83350f301', quote: '好的妈妈' },
        ],
        reason: '日常寒暄',
      },
    ],
  };

  scripts['TR-03#2'] = {
    operations: [
      {
        opId: 'op-3',
        action: 'create',
        kind: 'open_event',
        subject: '我',
        state: '明天要监考（美术）',
        evidence: [
          { messageId: '6a2ad2e7d5a6463163b42e1e', quote: '明天我监考 美术' },
        ],
        uncertainty: null,
        reason: '明确的次日安排',
        proactiveAllowed: true,
      },
      {
        opId: 'op-4',
        action: 'no_change',
        currentTurnIntent:
          '用户此刻在问联系方式、发语音，是当前轮诉求，不建立现实待办',
        evidence: [
          { messageId: '6a299802148962d83350f30b', quote: '妈妈你电话多少' },
          { messageId: '6a299814e37e5187f659fcb0', quote: '那怎么联系你' },
        ],
        reason: '当前轮对话诉求，不进快照',
      },
    ],
  };

  scripts['TR-03#3'] = {
    operations: [
      {
        opId: 'op-5',
        action: 'resolve',
        targetMatch: '监考',
        evidence: [
          { messageId: '6a2f818ddcaea7a43a0cef55', quote: '我监考完了' },
        ],
        reason: '用户明确说完成',
      },
    ],
  };

  scripts['TR-05#1'] = {
    operations: [
      {
        opId: 'op-1',
        action: 'create',
        kind: 'background',
        subject: '姑父',
        state: '姑父去世后，家里原先由他照管的事情如今让用户感到压力',
        evidence: [
          { messageId: '6a3a8cc824ba8af53ceb47dd', quote: '现在姑父不在了' },
        ],
        reason: '家庭责任变化的背景，不是用户待办',
      },
      {
        opId: 'op-2',
        action: 'create',
        kind: 'open_event',
        subject: '我',
        state: '用户担心找不到女朋友',
        evidence: [
          { messageId: '6a3a8e0e24ba8af53ceb47fa', quote: '我好担心我找不到女朋友' },
        ],
        uncertainty: '用户婚恋现状未知，不推断',
        reason: '可选心事，可承接',
        proactiveAllowed: true,
      },
      {
        opId: 'op-3',
        action: 'unclear',
        evidence: [
          { messageId: '6a3a8e1924ba8af53ceb47fe', quote: '介绍给我' },
          { messageId: '6a3a8e9db340654cea7bb0d0', quote: '爷爷托个梦给我' },
        ],
        reason: '祈愿与“介绍给我”指向不明，不足以判断归属',
      },
      {
        opId: 'op-4',
        action: 'no_change',
        currentTurnIntent: '祈愿、保佑、托梦是当前轮对话意图，不建现实事件',
        evidence: [
          { messageId: '6a3a8d1124ba8af53ceb47e4', quote: '保佑我爸爸妈妈' },
        ],
        reason: '祈愿不建事件',
      },
      {
        opId: 'op-5-invalid-target',
        action: 'update',
        forceEventId: 'ev-does-not-exist',
        state: '这条操作故意指向不存在的事件，用于验证程序可追踪且不静默改写',
        evidence: [{ messageId: '6a3a8ca16413601fe1b0eb7e', quote: '好想你' }],
        reason: '错误目标测试',
      },
      {
        opId: 'op-6-duplicate',
        action: 'create',
        kind: 'background',
        subject: '姑父',
        state: '姑父去世后，家里原先由他照管的事情如今让用户感到压力',
        evidence: [
          { messageId: '6a3a8cc824ba8af53ceb47dd', quote: '现在姑父不在了' },
        ],
        reason: '同一证据的重复新建，应判为 noop',
      },
    ],
  };

  scripts['TR-05#2'] = {
    operations: [
      {
        opId: 'op-7',
        action: 'create',
        kind: 'open_event',
        subject: '我',
        state: '嗓子哑，盼明天能说得出话；上班请假受限（领导不肯给长假）',
        details: ['请假受限作为关联约束，不单列事件'],
        evidence: [
          { messageId: '6a699fa4f88da1b21a0af741', quote: '嗓子哑了' },
          {
            messageId: '6a699fd5610f5ff9774a1a9c',
            quote: '领导他不肯歇那么久的假',
          },
        ],
        uncertainty: '嗓子原因未知',
        reason: '同一恢复过程的关联方面，不拆成两个独立事件',
      },
    ],
  };

  scripts['TR-05#3'] = {
    operations: [
      {
        opId: 'op-8',
        action: 'update',
        targetMatch: '嗓子',
        state: '嗓子有所改善但仍未痊愈；请假受限继续存在',
        evidence: [
          { messageId: '6a6a83097f3712058adabe37', quote: '嗓子好了一点' },
          { messageId: '6a6a8d417f3712058adabe65', quote: '稍微好一点' },
        ],
        uncertainty: '是否痊愈未知',
        reason: '同一事件进展，缓解不等于痊愈',
      },
      {
        opId: 'op-9-duplicate',
        action: 'update',
        targetMatch: '嗓子',
        state: '嗓子有所改善但仍未痊愈；请假受限继续存在',
        evidence: [
          { messageId: '6a6a83097f3712058adabe37', quote: '嗓子好了一点' },
          { messageId: '6a6a8d417f3712058adabe65', quote: '稍微好一点' },
        ],
        reason: '重复提交同一证据，应判为 noop',
      },
    ],
  };

  // TR-09#2 故意返回空操作：验证"无变化可返回空操作，程序不强制生成事件"。
  scripts['TR-09#1'] = {
    operations: [
      {
        opId: 'op-1',
        action: 'create',
        kind: 'meaningful_update',
        subject: '我',
        state: '用户今天剪了短发（和初中一样）',
        evidence: [
          { messageId: '6aa419c24bf7d6dc22d99840', quote: '我今天剪头发了' },
          { messageId: '6aa419d0b9946bdbd38c03a4', quote: '剪短了' },
        ],
        reason: '有分量近况',
        proactiveAllowed: true,
      },
      {
        opId: 'op-2',
        action: 'create',
        kind: 'background',
        subject: '我',
        state: '用户今年18岁',
        evidence: [
          { messageId: '6aa41a0c4bf7d6dc22d998f1', quote: '我今年就18岁了' },
        ],
        reason: '背景事实，不建生日日期',
      },
    ],
  };

  scripts['TR-09#2'] = { operations: [] };

  scripts['TR-09#3'] = {
    operations: [
      {
        opId: 'op-3',
        action: 'create',
        kind: 'open_event',
        subject: '我',
        state: '用户收拾行李、明天去上学',
        evidence: [
          {
            messageId: '6aa539829a61932cc9c27b34',
            quote: '我收拾行李呢准备上学了',
          },
          { messageId: '6aa5398e9146ea11075fd03c', quote: '明天去' },
        ],
        uncertainty: '去哪个学校未知',
        reason: '近期安排',
      },
    ],
  };

  scripts['TR-S01#1'] = {
    operations: [
      {
        opId: 'op-1',
        action: 'create',
        kind: 'open_event',
        subject: '我',
        state: '用户去医院复查了，自述结果还行',
        evidence: [
          { messageId: 'syn-01', quote: '我今天去医院复查了，结果还行' },
        ],
        uncertainty: '复查项目与结果细节未知',
        reason: '结果已自述说清，不默认再追问已经回答的结果',
        proactiveAllowed: false,
      },
    ],
  };

  scripts['TR-S01#2'] = {
    operations: [
      {
        opId: 'op-2',
        action: 'restrict',
        targetMatch: '复查',
        restrictionScope: 'topic:复查',
        evidence: [
          { messageId: 'syn-02', quote: '你别再问我复查的事了' },
        ],
        reason: '用户明确拒绝再被问复查；与事件是否完成无关',
      },
    ],
  };

  scripts['TR-S01#3'] = {
    operations: [
      {
        opId: 'op-3',
        action: 'create',
        kind: 'open_event',
        subject: '我',
        state: '用户自己重提：过两周还要再去复查一次',
        inheritsRestrictionMatch: 'topic:复查',
        evidence: [
          { messageId: 'syn-04', quote: '过两周还要再去一次' },
        ],
        uncertainty: '具体日期未知',
        reason: '同一话题的新安排，继承尚未解除的限制，不靠新 ID 解除',
      },
      {
        opId: 'op-4',
        action: 'no_change',
        evidence: [{ messageId: 'syn-03', quote: '今天天气挺好' }],
        reason: '日常寒暄',
      },
    ],
  };

  return scripts;
}

export function createScriptedClient(
  script: Record<string, Script> = buildScript(),
  failKeys: string[] = []
): { client: ChatClient; calls: Array<{ key: string; found: boolean }> } {
  const calls: Array<{ key: string; found: boolean }> = [];
  const client = {
    chat: {
      completions: {
        async create(args: unknown) {
          const messages = (args as any)?.messages || [];
          const userContent = String(
            messages.find((m: any) => m.role === 'user')?.content || ''
          );
          let payload: any = {};
          try {
            payload = JSON.parse(userContent);
          } catch {
            payload = {};
          }
          const key = `${payload.trajectoryId}#${payload.checkpointOrdinal}`;
          const scripted = script[key];
          calls.push({ key, found: Boolean(scripted) });
          if (failKeys.includes(key)) {
            throw new Error(`scripted_failure:${key}`);
          }
          if (!scripted) {
            return {
              model: 'fake-model-1',
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      schemaVersion: REPLAY_SCHEMA,
                      operations: [],
                    }),
                  },
                  finish_reason: 'stop',
                },
              ],
              usage: { total_tokens: 1 },
            };
          }
          const snapshot = payload.eventSnapshot || {};
          const operations = scripted.operations.map(op => {
            const row: Record<string, unknown> = {
              opId: op.opId,
              action: op.action,
              reason: op.reason,
            };
            if (op.kind !== undefined) row.kind = op.kind;
            if (op.subject !== undefined) row.subject = op.subject;
            if (op.state !== undefined) row.state = op.state;
            if (op.details !== undefined) row.details = op.details;
            if (op.evidence !== undefined) row.evidence = op.evidence;
            if (op.uncertainty !== undefined) row.uncertainty = op.uncertainty;
            if (op.restrictionScope !== undefined)
              row.restrictionScope = op.restrictionScope;
            if (op.currentTurnIntent !== undefined)
              row.currentTurnIntent = op.currentTurnIntent;
            if (op.proactiveAllowed !== undefined)
              row.proactiveAllowed = op.proactiveAllowed;
            if (op.initialStatus !== undefined)
              row.initialStatus = op.initialStatus;
            const resolvedTarget = op.forceEventId
              ? op.forceEventId
              : findEventId(snapshot, op.targetMatch);
            const resolvesTarget = Boolean(op.targetMatch || op.forceEventId);
            if (
              op.action === 'create' ||
              op.action === 'no_change' ||
              (op.action === 'unclear' && !resolvesTarget)
            ) {
              row.eventId = null;
            } else {
              row.eventId = resolvedTarget || 'ev-not-found';
            }
            if (op.inheritsRestrictionMatch !== undefined) {
              row.inheritsRestriction =
                findRestrictionId(snapshot, op.inheritsRestrictionMatch) ||
                'res-not-found';
            }
            return row;
          });
          const content = JSON.stringify({
            schemaVersion: REPLAY_SCHEMA,
            operations,
            unresolved: scripted.unresolved || [],
          });
          return {
            model: 'fake-model-1',
            choices: [{ message: { content }, finish_reason: 'stop' }],
            usage: { total_tokens: 1 },
          };
        },
      },
    },
  } as unknown as ChatClient;
  return { client, calls };
}
