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
  /(?:当)?我(哭|难过|难受|生气|害怕|焦虑|失眠|睡不着|一个人|喝酒)(?:的时候)?/;
const TOPIC_TRIGGER =
  /(?:聊到|说到|提到)(孩子|前夫|前妻|工作|钱|病|医院|死亡)(?:的时候)?/;

const ACTION =
  /(?:别|不要|不用|不想)(?:再)?([^，。！？!?]{1,24})/;

function compact(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function normalizeAction(raw: string): string {
  const value = raw.replace(/[“”"‘’']/g, '').trim();
  if (!value) return '';
  return value.replace(/^(?:再)/, '').trim();
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
    const action = ACTION.exec(value);
    const actionText = action ? normalizeAction(action[1]) : '';
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
    const action = ACTION.exec(value);
    const actionText = action ? normalizeAction(action[1]) : '';
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
    const action = ACTION.exec(value);
    const actionText = action ? normalizeAction(action[1]) : '';
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
