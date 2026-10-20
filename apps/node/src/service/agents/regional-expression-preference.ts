/**
 * “你是XX人 / 我们是XX人 / 说XX话” → 地区表达偏好。
 *
 * 只做地区名识别，不判断籍贯真值，也不写角色生平；输出一条可以注入的
 * 表达偏好：沿用该地区的表达习惯/方言。纯规则，不调用模型。
 */

export interface RegionalExpressionPreference {
  region?: string;
  dialect?: string;
  source: 'agent' | 'shared' | 'dialect';
  matched: string;
  value: string;
}

const REGION_STOP = new Set([
  '好人',
  '坏人',
  '外人',
  '内人',
  '男人',
  '女人',
  '老人',
  '年轻人',
  '亲人',
  '家人',
  '爱人',
  '客人',
  '敌人',
  '陌生人',
  '本人',
  '城里人',
  '农村人',
  '中国',
  '外国',
  '中国人',
  '外国人',
  '本地',
  '外地',
  '农村',
  '城市',
  '年轻',
  '老年',
  '病人',
  '盲人',
  '残疾人',
  '成年人',
  '未成年人',
  '穷人',
  '富人',
  '小人',
  '大人',
  '高人',
  '能人',
  '名人',
  '艺人',
  '诗人',
  '文人',
  '军人',
  '工人',
  '农民',
  '商人',
  '熟人',
  '生人',
  '友人',
  '故人',
  '佳人',
  '美人',
  '众人',
  '每人',
  '人人',
  '哪里',
  '哪儿',
  '什么',
  '谁',
]);

const DIALECT_REGION: Record<string, string> = {
  粤语: '广东',
  广东话: '广东',
  客家话: '客家',
  闽南语: '闽南',
  潮汕话: '潮汕',
  上海话: '上海',
  东北话: '东北',
  四川话: '四川',
  重庆话: '重庆',
  湖南话: '湖南',
  湖北话: '湖北',
  河南话: '河南',
  山东话: '山东',
};

const QUESTION_OR_HYPOTHETICAL =
  /[?？]|(?:吗|呢|哪里|哪儿|什么|谁|是不是|会不会|能不能|如果|要是|假如|万一)/;
const NEGATION = /(?:不是|并非|不算|不再是)/;

const AGENT_PATTERN =
  /(?:你|您)(?:是|也是|就是|来自|老家是)([\u4e00-\u9fa5]{2,8}?)(?:人|的)/;
const SHARED_PATTERN =
  /我们(?:都|也)?是([\u4e00-\u9fa5]{2,8}?)(?:人|的)/;
const DIALECT_PATTERN =
  /(?:说|讲|用)([\u4e00-\u9fa5]{1,8}?(?:话|语|方言))/;

function normalizeRegion(raw: string): string | undefined {
  let value = (raw || '').trim();
  if (!value) return undefined;
  value = value.replace(/^(?:我们|我|都|也)+/, '').trim();
  value = value.replace(/(?:省|市|自治区|特别行政区|地区)$/, '').trim();
  if (value.length < 2 || value.length > 8) return undefined;
  if (REGION_STOP.has(value)) return undefined;
  if (/^(?:哪|什么|谁|咋|怎么)/.test(value)) return undefined;
  return value;
}

function normalizeDialect(raw: string): {
  dialect: string;
  region?: string;
} {
  const dialect = (raw || '').trim();
  if (!dialect || /^(?:的话|这话|那话|说话)$/.test(dialect)) return { dialect: '' };
  if (dialect === '普通话') return { dialect, region: undefined };
  const mapped = DIALECT_REGION[dialect];
  const base = dialect.replace(/(?:话|语|方言)$/, '');
  const region = mapped || (base.length >= 2 ? base : undefined);
  return { dialect, region };
}

/**
 * 返回高置信的地区表达偏好；疑问、否定、假设、非地区称谓返回 undefined。
 */
export function detectRegionalExpressionPreference(
  text: string
): RegionalExpressionPreference | undefined {
  const value = (text || '').replace(/\s+/g, ' ').trim();
  if (!value || value.length > 400) return undefined;
  if (QUESTION_OR_HYPOTHETICAL.test(value)) return undefined;
  if (NEGATION.test(value)) return undefined;

  const dialectMatch = DIALECT_PATTERN.exec(value);
  if (dialectMatch) {
    const { dialect, region } = normalizeDialect(dialectMatch[1]);
    if (dialect) {
      const regionText = region ? `，沿用${region}地区的表达习惯` : '';
      return {
        region,
        dialect,
        source: 'dialect',
        matched: dialectMatch[0],
        value: `用户希望用${dialect}交流${regionText}`,
      };
    }
  }

  const agentMatch = AGENT_PATTERN.exec(value);
  if (agentMatch) {
    const region = normalizeRegion(agentMatch[1]);
    if (region) {
      return {
        region,
        source: 'agent',
        matched: agentMatch[0],
        value: `用户希望沿用${region}地区的表达习惯交流`,
      };
    }
  }

  const sharedMatch = SHARED_PATTERN.exec(value);
  if (sharedMatch) {
    const region = normalizeRegion(sharedMatch[1]);
    if (region) {
      return {
        region,
        source: 'shared',
        matched: sharedMatch[0],
        value: `用户希望沿用${region}地区的表达习惯交流`,
      };
    }
  }

  return undefined;
}
