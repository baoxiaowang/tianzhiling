/**
 * 用户直接提要求的轻量路由。
 *
 * 只做“这句话是不是一个持久、可执行的明确要求”的正则判断，不调用模型。
 * 真正的落库仍复用 agent-profile-fact 的规则抽取，避免再维护一套事实解析。
 */

export type UserRequestKind =
  | 'address'
  | 'style'
  | 'taboo'
  | 'memory'
  | 'promise'
  | 'one_off'
  | 'task';

export interface UserRequestSignal {
  kind: UserRequestKind;
  confidence: 'high' | 'medium';
  durable: boolean;
  matched: string;
}

const ONE_OFF_PATTERN =
  /(?:今天|今晚|这会儿|这次|这回|暂时|待会|一会|先别|先不要|先不用)/;

const DURABLE_PATTERN =
  /(?:以后|今后|从现在起|往后|之后|每次|都|一直|总是|别总|别老是|不要总|不要老|别再|不用再)/;

const ADDRESS_PATTERN =
  /(?:以后|往后|之后|都)?(?:叫我|喊我|称呼我|我叫你|称呼你)[\u4e00-\u9fa5A-Za-z·]{1,12}/;

const STYLE_PATTERN =
  /(?:以后|往后|之后|都|别总|别老是|不要总|不要老|别再|不用再)?(?:别|不要|少|多)?(?:再)?(?:说|问|提|讲|发|回复|话)/;

const TABOO_PATTERN =
  /(?:以后|之后)?(?:别|不要|不许)(?:再)?(?:提|说)[^，。！？!?]{2,24}/;

const MEMORY_PATTERN = /(?:记住|记一下|别忘了|帮我记)/;

const PROMISE_PATTERN = /(?:答应我|你答应过|说好了)/;

const TASK_PATTERN = /(?:帮我|给我|替我)(?:写|查|找|做|算|翻译|总结|整理)/;

function compact(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

/**
 * 返回命中的请求类型；普通聊天、纯情绪、纯提问返回 undefined。
 * 这里不判断“该不该答应”，只判断“要不要进入请求处理”。
 */
export function detectUserRequest(text: string): UserRequestSignal | undefined {
  const value = compact(text);
  if (!value || value.length > 400) return undefined;

  const durable = DURABLE_PATTERN.test(value);
  const oneOff = ONE_OFF_PATTERN.test(value);
  if (oneOff && !durable) {
    return { kind: 'one_off', confidence: 'high', durable: false, matched: 'one_off' };
  }

  if (MEMORY_PATTERN.test(value)) {
    return { kind: 'memory', confidence: 'high', durable, matched: 'memory' };
  }
  if (ADDRESS_PATTERN.test(value)) {
    return { kind: 'address', confidence: 'high', durable, matched: 'address' };
  }
  if (TABOO_PATTERN.test(value) && durable) {
    return { kind: 'taboo', confidence: 'high', durable, matched: 'taboo' };
  }
  if (STYLE_PATTERN.test(value) && durable) {
    return { kind: 'style', confidence: 'high', durable, matched: 'style' };
  }
  if (PROMISE_PATTERN.test(value)) {
    return { kind: 'promise', confidence: 'medium', durable, matched: 'promise' };
  }
  if (TASK_PATTERN.test(value)) {
    return { kind: 'task', confidence: 'high', durable: false, matched: 'task' };
  }
  return undefined;
}

/** 只有这三类直接落成可注入的偏好事实；memory/promise/task 交给现有链路或主模型。 */
export function isDirectPreferenceRequest(kind: UserRequestKind): boolean {
  return kind === 'address' || kind === 'style' || kind === 'taboo';
}
