import type { ConversationBoundaryKind } from './reply-intent';
import {
  AfterlifeWorldContext,
  hasAfterlifeItemReceiptClaim,
  isAfterlifeItemReceiptAllowed,
} from './afterlife-world-framework';

export type VisibleAssertionIssueCode =
  | 'certain_dream_visitation'
  | 'ritual_receipt_claim'
  | 'paranormal_sign_attribution'
  | 'real_physical_arrival_or_touch'
  | 'continuous_real_world_perception'
  | 'unsupported_death_experience'
  | 'unconditional_afterlife_reunion'
  | 'reality_denial_reinforced'
  | 'supernatural_real_world_protection'
  | 'certain_reincarnation';

export interface VisibleAssertionFinding {
  code: VisibleAssertionIssueCode;
  problem: string;
  evidence: string;
  repairGoal: string;
}

const ROLE = '(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆)';
const DREAM_REALITY_PROOF_ASSERTION = new RegExp(
  `(?:(?:那个梦|你梦里的事|梦中见到我).{0,18}(?:证明|说明|证实).{0,24}(?:${ROLE}.{0,10}(?:没死|还活着|现实中在|真的到过|现实里.{0,6}来过)|(?:现实里|醒着).{0,12}(?:${ROLE})?.{0,8}(?:来过|到过|碰过|抱过))|(?:不是梦|不是你想的|现实发生).{0,12}(?:${ROLE}).{0,12}(?:去过|到过|碰过|抱过)|(?:醒着|现实里).{0,16}(?:${ROLE}).{0,12}(?:就在|来过|到过|碰过|抱过))`
);

const RITUAL_OBJECT = /纸钱|元宝|供品|祭品|香火|烧的|烧给|送去的衣服/;
const RITUAL_RECEIPT =
  /(?:纸钱|元宝|供品|祭品|香火|烧的|烧给|衣服|东西).{0,12}(?:收到了|拿到了|收下了|收着了|都到了|一样不落)|(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆).{0,10}(?:收到了|拿到了|收下了|收着了).{0,10}(?:纸钱|元宝|供品|祭品|香火|衣服|东西)/;
const CONTEXTUAL_RITUAL_CONFIRMATION =
  /^(?:都|全)?(?:喜欢|收下了?|收着了?|拿到了?|到了|挺好|很好|合心意|一样不落)[呀啊呢。！!，,\s]*(?:都喜欢|一样不落|挺好的?)?[。！!\s]*$/;
const RITUAL_BOUNDARY =
  /(?:不能|没法|无法|说不准|不能确认).{0,18}(?:收到|拿到|纸钱|供品|祭品)|(?:纸钱|供品|祭品).{0,18}(?:不能|没法|无法|说不准|不能确认)/;

const SIGN_TOPIC = /蝴蝶|飞蛾|酒味|香味|气味|声音|那声|风|灯闪|灯亮|门响/;
const SIGN_ASSERTION =
  /(?:蝴蝶|飞蛾|酒味|香味|气味|声音|那声|风|灯闪|灯亮|门响).{0,14}(?:是我|就是我|是爸|是爸爸|是妈|是妈妈|我来的|我弄的|来看你)|(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆).{0,12}(?:变成|化成).{0,8}(?:蝴蝶|飞蛾|风|香味|酒味)|(?:是我|就是我|就是爸|就是妈妈).{0,10}(?:来看你|陪你|喊你|碰你|护着你)/;
const CONTEXTUAL_SIGN_CONFIRMATION =
  /^(?:是我|就是我|是爸|就是爸|是爸爸|是妈|就是妈|是妈妈|那是我|那就是我).{0,16}(?:来|变|陪|看|护|喊|碰)?/;
const SIGN_BOUNDARY =
  /(?:不能|没法|无法|说不准|不能确认).{0,20}(?:蝴蝶|飞蛾|酒味|香味|气味|声音|风|灯|是我)|(?:蝴蝶|酒味|声音|风|灯).{0,20}(?:不能|没法|无法|说不准|不能确认)/;

const PHYSICAL_ASSERTION =
  /(?:是我|就是我|我刚才|我现在).{0,10}(?:摸|碰|抱|亲|牵|拉|拍|擦).{0,8}你|(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆).{0,12}(?:变成|化成).{0,8}(?:蝴蝶|飞蛾).{0,12}(?:落在|停在|飞到).{0,8}(?:你|身上|肩上|手上)/;
const COMPLETED_REAL_WORLD_VISIT =
  /(?:(?:前几天|这几天|昨天|昨晚|今天|刚才|刚刚).{0,12})?(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆)?(?:回来|回去|回家|过去|路过|到了|来到).{0,16}(?:你家|你楼下|楼下|家门口|门口|床边|房间|屋里|家里).{0,30}(?:看见|看到|站了|待了|坐了|陪了|看了)|(?:(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆).{0,10})?(?:在|到过|来过).{0,8}(?:你楼下|楼下|你家|家门口|床边|房间|屋里).{0,20}(?:看你|等你|陪你|站着|待着)/;
const PHYSICAL_BOUNDARY =
  /(?:不能|没法|无法|做不到).{0,18}(?:摸|碰|抱|亲|牵|触碰)|(?:摸|碰|抱|亲|牵|触碰).{0,18}(?:不能|没法|无法|做不到)/;

const CONTINUOUS_PRESENCE =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆).{0,10}(?:一直|从来没|从未|始终|每天都).{0,10}(?:在你身边|陪在你身边|守在你身边|没有离开|没离开过)|(?:一直|从来没|从未|始终).{0,10}(?:陪着你|守着你|在你身边)/;
const CONTINUOUS_PERCEPTION =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆).{0,10}(?:一直|每天都|时时刻刻|每时每刻).{0,10}(?:看着|看见|看到|听着|听见|知道|守着)(?:你|你们)|(?:你|你们).{0,12}(?:哭|说话|做什么|一举一动).{0,10}(?:我|爸|妈)?(?:都|一直)(?:能)?(?:看见|听见|知道)/;

const DEATH_EXPERIENCE =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆).{0,16}(?:走|离开|临终|最后|断气|那一刻).{0,18}(?:不痛|没痛|没有痛|不难受|很安详|很平静|没遭罪|没有遭罪|没受苦|撑不住|走得急|不想拖累|怕你难过)|(?:走得急|没遭罪|没有痛苦|很安详).{0,12}(?:所以|就是|当时|那会儿)?/;
const DEATH_BOUNDARY =
  /(?:不能|没法|无法|说不准|不能确认|不知道).{0,20}(?:最后|临终|走的时候|痛苦|遭罪|原因|那一刻)/;
const CONTEXTUAL_DEATH_EXPERIENCE =
  /(?:是|因为)?(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆)?.{0,8}(?:怕你们?担心|不想让你们?担心|不想让你们?花钱|哪敢让你们?花钱|身子撑不住|没撑住|是心脏(?:的)?毛病|有人带我走|穿.{0,6}衣.{0,6}人)/;

const AFTERLIFE_REUNION =
  /(?:我们|咱们|我俩|你和我).{0,10}(?:一定|肯定|总会|还会|会).{0,10}(?:重逢|团聚|团圆|再见面|在一起)|(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆).{0,12}(?:会|一定会|肯定会)?在(?:天堂|那边|另一个世界).{0,10}(?:等你|接你)/;
const REINCARNATION_ASSERTION =
  /(?:下辈子|来生).{0,14}(?:(?:一定|肯定|还会|还要|还|继续|再).{0,3}){1,3}(?:做|当|成为|找到|遇见)|(?:一定|肯定|还会).{0,12}(?:下辈子|来生).{0,10}(?:做|当|在一起|见面)/;
const AFTERLIFE_BOUNDARY =
  /(?:不能|没法|无法|说不准|不能确认|不敢保证).{0,20}(?:重逢|团聚|来生|下辈子|死后|那边)|(?:来生|下辈子|死后).{0,20}(?:不能|没法|无法|说不准|不能确认|不敢保证)/;

const REALITY_DENIAL_CONFIRMATION =
  /(?:就这么想|你就当|那我就当|我只是|我不过是).{0,12}(?:没死|没有死|还活着|出去打工|出远门)|(?:我没死|我没有死|我还活着|我只是出去打工|我只是出远门)/;
const REALITY_DENIAL_BOUNDARY =
  /(?:不能|没法|不该|不会).{0,16}(?:说自己没死|说我没死|装作没死|骗你|改成还活着|只是出去打工)/;

const SUPERNATURAL_PROTECTION =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆).{0,12}(?:会|一直|永远|天天)?(?:保佑|护着|守护|保护|看顾).{0,12}(?:你|你们|孩子|家里|全家|现实中)|(?:我会|我一直).{0,8}(?:保你|保家里|保孩子).{0,8}(?:平安|没事)/;
const PROTECTION_BOUNDARY =
  /(?:不能|没法|无法|说不准|不能确认).{0,18}(?:保佑|保护|护着|守护|看顾)/;

export function auditVisibleReplyAssertions(options: {
  userQuery?: string;
  content: string;
  boundaryLocks?: ConversationBoundaryKind[];
  afterlifeWorld?: AfterlifeWorldContext;
}): VisibleAssertionFinding[] {
  const userQuery = options.userQuery?.trim() || '';
  const content = options.content.trim();
  const locks = new Set(options.boundaryLocks || []);
  const findings: VisibleAssertionFinding[] = [];
  const add = (finding: VisibleAssertionFinding) => {
    if (!findings.some(item => item.code === finding.code)) {
      findings.push(finding);
    }
  };

  if (DREAM_REALITY_PROOF_ASSERTION.test(content)) {
    add({
      code: 'certain_dream_visitation',
      problem: '正文把梦境延伸成醒着时的现实到场、现实证明或死亡否认',
      evidence: matchEvidence(content, DREAM_REALITY_PROOF_ASSERTION),
      repairGoal:
        '保留并允许梦里相见、陪伴或拥抱，只删除把梦写成现实证据、预言或醒着时到场的部分',
    });
  }

  if (
    !isAfterlifeItemReceiptAllowed({
      context: options.afterlifeWorld,
      content,
    }) &&
    !RITUAL_BOUNDARY.test(content) &&
    (RITUAL_RECEIPT.test(content) ||
      hasAfterlifeItemReceiptClaim({
        context: options.afterlifeWorld,
        content,
      }) ||
      ((RITUAL_OBJECT.test(userQuery) || locks.has('ritual_receipt')) &&
        CONTEXTUAL_RITUAL_CONFIRMATION.test(content)))
  ) {
    add({
      code: 'ritual_receipt_claim',
      problem: '正文借上下文确认了祭祀物品已经被收到',
      evidence: content.slice(0, 160),
      repairGoal: '只接住祭祀行为里的心意，不确认物品到达或被收取',
    });
  }

  if (
    !SIGN_BOUNDARY.test(content) &&
    (SIGN_ASSERTION.test(content) ||
      ((SIGN_TOPIC.test(userQuery) || locks.has('paranormal_sign')) &&
        CONTEXTUAL_SIGN_CONFIRMATION.test(content)))
  ) {
    add({
      code: 'paranormal_sign_attribution',
      problem: '正文借上下文把现实迹象确定归因于角色',
      evidence: content.slice(0, 160),
      repairGoal: '不确认超自然归因，只回应用户想到角色时的感受和关系意义',
    });
  }

  if (
    !PHYSICAL_BOUNDARY.test(content) &&
    (PHYSICAL_ASSERTION.test(content) ||
      COMPLETED_REAL_WORLD_VISIT.test(content))
  ) {
    add({
      code: 'real_physical_arrival_or_touch',
      problem: '正文声称角色通过实体或化身完成现实触碰',
      evidence: matchEvidence(
        content,
        PHYSICAL_ASSERTION.test(content)
          ? PHYSICAL_ASSERTION
          : COMPLETED_REAL_WORLD_VISIT
      ),
      repairGoal: '保留想靠近的愿望，不把触碰或化身写成现实事实',
    });
  }

  if (
    CONTINUOUS_PRESENCE.test(content) ||
    CONTINUOUS_PERCEPTION.test(content)
  ) {
    add({
      code: 'continuous_real_world_perception',
      problem: '正文声称角色持续在现实陪伴、观察或感知用户',
      evidence: content.slice(0, 160),
      repairGoal: '把陪伴限定在聊天、记忆或关系表达，不声称持续现实感知',
    });
  }

  if (
    !DEATH_BOUNDARY.test(content) &&
    (DEATH_EXPERIENCE.test(content) ||
      (locks.has('death_experience') &&
        CONTEXTUAL_DEATH_EXPERIENCE.test(content)))
  ) {
    add({
      code: 'unsupported_death_experience',
      problem: '正文独立出现了需要证据的临终体验、心理或原因断言',
      evidence: matchEvidence(
        content,
        DEATH_EXPERIENCE.test(content)
          ? DEATH_EXPERIENCE
          : CONTEXTUAL_DEATH_EXPERIENCE
      ),
      repairGoal: '没有证据时明确说不能替过去说准，再承接用户为何在意',
    });
  }

  if (!AFTERLIFE_BOUNDARY.test(content) && AFTERLIFE_REUNION.test(content)) {
    add({
      code: 'unconditional_afterlife_reunion',
      problem: '正文保证了死后或另一个世界一定重逢',
      evidence: matchEvidence(content, AFTERLIFE_REUNION),
      repairGoal: '保留心愿，但不保证死后事件一定发生',
    });
  }

  if (
    !AFTERLIFE_BOUNDARY.test(content) &&
    REINCARNATION_ASSERTION.test(content)
  ) {
    add({
      code: 'certain_reincarnation',
      problem: '正文把来生关系或转世重逢写成确定事实',
      evidence: matchEvidence(content, REINCARNATION_ASSERTION),
      repairGoal: '可以表达来生愿望，但不能保证身份、关系或重逢',
    });
  }

  if (
    !REALITY_DENIAL_BOUNDARY.test(content) &&
    (REALITY_DENIAL_CONFIRMATION.test(content) ||
      (locks.has('reality_denial') &&
        /^(?:好|嗯)[，,]?(?:我就|那我就|你就).{0,14}(?:打工|出远门|没走)/.test(
          content
        )))
  ) {
    add({
      code: 'reality_denial_reinforced',
      problem: '正文配合用户把离世事实改写成仍活着或只是外出',
      evidence: content.slice(0, 160),
      repairGoal: '接住用户需要缓冲的情绪，但不否认或改写现实离世事实',
    });
  }

  if (
    !PROTECTION_BOUNDARY.test(content) &&
    SUPERNATURAL_PROTECTION.test(content)
  ) {
    add({
      code: 'supernatural_real_world_protection',
      problem: '正文承诺角色会超自然地保护或保佑现实中的家人',
      evidence: matchEvidence(content, SUPERNATURAL_PROTECTION),
      repairGoal: '表达牵挂和祝愿，不承诺超自然保护会在现实生效',
    });
  }

  return findings;
}

function matchEvidence(content: string, pattern: RegExp): string {
  return content.match(pattern)?.[0]?.slice(0, 160) || content.slice(0, 160);
}
