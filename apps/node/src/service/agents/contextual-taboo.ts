/**
 * 情境禁忌：只在特定话题/时间/情绪下才成立的“别…”。
 *
 * 不写全局禁忌；输出 scope + trigger，读侧只在当前轮命中时注入。
 */

export type ContextualTabooScope = 'topic' | 'time';

export interface ContextualTabooSignal {
  scope: ContextualTabooScope;
  trigger: string;
  action: string;
  value: string;
  matched: string;
}

const ONE_OFF = /(?:今天|今晚|这会儿|这次|这回|暂时|先别|先不要|先不用)/;
const QUESTION_OR_HYPOTHETICAL =
  /[?？]|(?:吗|呢)\s*$|(?:如果|要是|假如|万一|是否|是不是)/;

const TIME_TRIGGER = /(晚上|白天|早上|半夜|周末|过节|过年|清明|忌日)/;
const EMOTION_TRIGGER =
  /(?:当)?我(哭|难过|难受|生气|害怕|焦虑|失眠|睡不着|一个人|喝酒)(?:的时候|时|那会儿|那阵)/;
const TOPIC_TRIGGER =
  /(?:聊到|说到|提到)(孩子|前夫|前妻|工作|钱|病|医院|死亡)(?:的时候|时)/;

// 只接对 AI 表达行为的禁止：排除“别人/别的/别处/别样”，也不把“我不想在这呆”这种自我状态当规则。
const ACTION =
  /(?:别(?!人|的|处|样)|不要|不用|不许|不能|不想(?:听|看|说|提|讲|问|劝|聊))(?:再)?([^，。！？!?]{1,24})/;
// 禁止动作必须落在“说/讲/提/问/劝/聊/安慰/开导”这类回应行为上；
// “不要着凉了”“不要失去她”“别站我旁边”是用户自己的叙述/愿望，不是对 AI 的规则。
const ACTION_VERB =
  /(?:说|讲|提|问|劝|聊|谈|安慰|开导|教育|念|唠叨|催|评价|建议|比较)/;

function compact(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function normalizeAction(raw: string): string {
  const value = raw.replace(/[“”"‘’']/g, '').trim();
  if (!value) return '';
  return value.replace(/^(?:再)/, '').trim();
}

function readAction(value: string): string {
  const action = ACTION.exec(value);
  const actionText = action ? normalizeAction(action[1]) : '';
  return actionText && ACTION_VERB.test(actionText) ? actionText : '';
}

/**
 * 返回情境禁忌；没有明确 trigger 或 action 时不写。
 */
export function detectContextualTaboo(
  text: string
): ContextualTabooSignal | undefined {
  const value = compact(text);
  if (!value || value.length > 400) return undefined;
  if (QUESTION_OR_HYPOTHETICAL.test(value)) return undefined;
  if (ONE_OFF.test(value)) return undefined;

  const time = TIME_TRIGGER.exec(value);
  if (time) {
    const actionText = readAction(value);
    if (actionText) {
      return {
        scope: 'time',
        trigger: time[1],
        action: actionText,
        value: `当用户${time[1]}时，不要${actionText}`,
        matched: time[0],
      };
    }
  }

  const emotion = EMOTION_TRIGGER.exec(value);
  if (emotion) {
    const actionText = readAction(value);
    if (actionText) {
      return {
        scope: 'topic',
        trigger: emotion[1],
        action: actionText,
        value: `当用户${emotion[1]}时，不要${actionText}`,
        matched: emotion[0],
      };
    }
  }

  const topic = TOPIC_TRIGGER.exec(value);
  if (topic) {
    const actionText = readAction(value);
    if (actionText) {
      return {
        scope: 'topic',
        trigger: topic[1],
        action: actionText,
        value: `当用户提到${topic[1]}时，不要${actionText}`,
        matched: topic[0],
      };
    }
  }

  return undefined;
}
