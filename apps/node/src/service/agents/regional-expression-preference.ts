/**
 * “你是XX人 / 我们是XX人 / 说XX话” → 地区表达偏好。
 *
 * 只做地区名识别，不判断籍贯真值，也不写角色生平；输出一条可以注入的
 * 表达偏好：沿用该地区的表达习惯/方言。纯规则，不调用模型。
 */

export interface RegionalExpressionPreference {
  region?: string;
  dialect?: string;
  source: 'agent' | 'shared' | 'dialect' | 'user' | 'expression';
  expressions?: string[];
  confidence?: 'high' | 'medium';
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

/**
 * 高置信地区名白名单。规则只在这里命中：任意 2–8 个汉字加“人/的”不再算地区，
 * 避免“你是个很好很好的人”“你是我心里永远的痛”这类句子被写成地区偏好。
 */
const REGION_NAMES = new Set(
  (
    [
      // 省级
      '北京', '天津', '上海', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江',
      '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南',
      '广东', '海南', '四川', '贵州', '云南', '陕西', '甘肃', '青海', '台湾',
      '内蒙古', '广西', '西藏', '宁夏', '新疆', '香港', '澳门',
      // 大区 / 方言区
      '东北', '北方', '南方', '江南', '中原', '西北', '西南', '华南', '华北',
      '华东', '华中', '客家', '闽南', '潮汕', '巴蜀',
      // 省会 / 直辖市
      '石家庄', '太原', '呼和浩特', '沈阳', '长春', '哈尔滨', '南京', '杭州',
      '合肥', '福州', '南昌', '济南', '郑州', '武汉', '长沙', '广州', '南宁',
      '海口', '成都', '贵阳', '昆明', '拉萨', '西安', '兰州', '西宁', '银川',
      '乌鲁木齐', '台北',
      // 常见地级市 / 地区
      '深圳', '珠海', '佛山', '东莞', '中山', '惠州', '汕头', '潮州', '揭阳',
      '湛江', '茂名', '肇庆', '江门', '阳江', '清远', '韶关', '梅州', '河源',
      '汕尾', '云浮', '苏州', '无锡', '常州', '南通', '扬州', '徐州', '盐城',
      '泰州', '镇江', '淮安', '连云港', '宿迁', '宁波', '温州', '绍兴', '嘉兴',
      '湖州', '金华', '台州', '丽水', '衢州', '舟山', '厦门', '泉州', '漳州',
      '莆田', '三明', '南平', '龙岩', '宁德', '青岛', '烟台', '潍坊', '临沂',
      '淄博', '济宁', '泰安', '威海', '日照', '德州', '聊城', '滨州', '菏泽',
      '枣庄', '东营', '洛阳', '开封', '新乡', '南阳', '许昌', '平顶山', '安阳',
      '焦作', '商丘', '信阳', '周口', '驻马店', '三门峡', '漯河', '濮阳', '鹤壁',
      '宜昌', '襄阳', '荆州', '黄石', '十堰', '孝感', '荆门', '黄冈', '咸宁',
      '随州', '鄂州', '株洲', '湘潭', '衡阳', '岳阳', '常德', '郴州', '益阳',
      '永州', '邵阳', '怀化', '娄底', '张家界', '湘西', '芜湖', '蚌埠', '安庆',
      '阜阳', '黄山', '马鞍山', '淮南', '淮北', '铜陵', '宿州', '滁州', '六安',
      '宣城', '池州', '亳州', '咸阳', '宝鸡', '渭南', '延安', '榆林', '汉中',
      '安康', '商洛', '铜川', '天水', '白银', '酒泉', '张掖', '武威', '平凉',
      '庆阳', '定西', '陇南', '曲靖', '玉溪', '大理', '丽江', '保山', '昭通',
      '普洱', '临沧', '楚雄', '红河', '文山', '西双版纳', '遵义', '六盘水',
      '安顺', '毕节', '铜仁', '黔东南', '黔南', '黔西南', '柳州', '桂林',
      '梧州', '北海', '钦州', '防城港', '玉林', '百色', '河池', '贵港', '贺州',
      '来宾', '崇左', '三亚', '儋州', '唐山', '保定', '廊坊', '邯郸', '邢台',
      '沧州', '承德', '张家口', '秦皇岛', '衡水', '大同', '临汾', '运城',
      '长治', '晋城', '晋中', '忻州', '吕梁', '阳泉', '朔州', '大连', '鞍山',
      '抚顺', '本溪', '丹东', '锦州', '营口', '阜新', '辽阳', '盘锦', '铁岭',
      '朝阳', '葫芦岛', '四平', '通化', '白山', '松原', '白城', '延边',
      '齐齐哈尔', '牡丹江', '佳木斯', '大庆', '鸡西', '双鸭山', '伊春',
      '七台河', '鹤岗', '黑河', '绥化', '大兴安岭', '包头', '鄂尔多斯',
      '赤峰', '通辽', '呼伦贝尔', '巴彦淖尔', '乌兰察布', '兴安盟',
      '锡林郭勒', '阿拉善', '石嘴山', '吴忠', '固原', '中卫', '海东', '海北',
      '黄南', '果洛', '玉树', '海西', '克拉玛依', '吐鲁番', '哈密', '昌吉',
      '博尔塔拉', '巴音郭楞', '阿克苏', '克孜勒苏', '喀什', '和田', '伊犁',
      '塔城', '阿勒泰', '日喀则', '昌都', '林芝', '山南', '那曲', '阿里',
      '绵阳', '德阳', '南充', '宜宾', '泸州', '乐山', '自贡', '达州', '广元',
      '遂宁', '内江', '眉山', '广安', '雅安', '巴中', '资阳', '攀枝花',
      '西昌', '凉山', '阿坝', '甘孜',
    ] as string[]
  ).join(' ')
    .split(/\s+/)
    .filter(Boolean)
);

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
  陕西话: '陕西',
  山西话: '山西',
  甘肃话: '甘肃',
  宁夏话: '宁夏',
  新疆话: '新疆',
  内蒙古话: '内蒙古',
  云南话: '云南',
  贵州话: '贵州',
  广西话: '广西',
  福建话: '福建',
  江西话: '江西',
  安徽话: '安徽',
  江苏话: '江苏',
  浙江话: '浙江',
  海南话: '海南',
  台湾话: '台湾',
  天津话: '天津',
  北京话: '北京',
  河北话: '河北',
  吴语: '江苏',
  赣语: '江西',
  湘语: '湖南',
};

const QUESTION_OR_HYPOTHETICAL =
  /[?？]|(?:吗|呢|哪里|哪儿|什么|谁|是不是|会不会|能不能|如果|要是|假如|万一)/;
const NEGATION =
  /(?:不是|并非|不算|不再是|不会|不说|没(?:有)?说|别(?:说|用)|不要(?:说|用)|不想(?:说|用)|听不懂|不会讲|不会说)/;

const AGENT_PATTERN =
  /(?:你|您)(?:是|也是|就是|来自|老家是)([\u4e00-\u9fa5]{2,8}?)(?:人|的)/;
const SHARED_PATTERN =
  /我们(?:都|也)?是([\u4e00-\u9fa5]{2,8}?)(?:人|的)/;
const USER_PATTERNS = [
  /(?:^|[，,。；;])(?:我|俺|本人)(?:是|也是|就是)([\u4e00-\u9fa5]{2,8}?)(?:人|的)/,
  /(?:^|[，,。；;])(?:我|俺|本人)来自([\u4e00-\u9fa5]{2,8}?)(?=$|[，,。；;])/,
  /(?:^|[，,。；;])(?:我|俺|本人)(?:老家是|老家在|老家|家在|住在)([\u4e00-\u9fa5]{2,8}?)(?:人|的|那边|这儿|这里|长大|出生)?/,
  /(?:^|[，,。；;])(?:我|俺|本人)在([\u4e00-\u9fa5]{2,8}?)(?:长大|出生|生活)/,
];
const DIALECT_PATTERN =
  /(?:说|讲|用)([\u4e00-\u9fa5]{1,8}?(?:话|语|方言))/;

interface ExpressionLexiconEntry {
  region: string;
  dialect?: string;
  strong: string[];
  weak?: string[];
}

/**
 * 地方用语高信号词表。只收辨识度较高的词/短语；普通普通话常用字
 * （如“整/中/啥”）不作为单条强证据，避免把正常表达误判成方言。
 */
const EXPRESSION_LEXICON: ExpressionLexiconEntry[] = [
  { region: '东北', dialect: '东北话', strong: ['嘎哈', '咋整', '埋汰', '唠嗑', '贼拉', '得瑟', '膈应', '敞亮'], weak: ['稀罕', '麻溜', '忽悠'] },
  { region: '四川', dialect: '四川话', strong: ['巴适得板', '摆龙门阵', '瓜娃子', '哦豁', '扯把子'], weak: ['巴适', '安逸', '啥子', '晓得', '要得', '莫得', '咋个'] },
  { region: '重庆', dialect: '重庆话', strong: ['巴适得板', '摆龙门阵', '瓜娃子', '雄起', '扯把子', '哦豁'], weak: ['巴适', '要得', '莫得', '咋个'] },
  { region: '广东', dialect: '粤语', strong: ['唔该', '点解', '冇', '佢', '得闲', '食饭', '早晨', '唔系'], weak: ['唔', '睇', '乜'] },
  { region: '上海', dialect: '上海话', strong: ['阿拉', '侬', '覅', '白相', '结棍'], weak: ['伐', '勿', '伊', '适意'] },
  { region: '湖南', dialect: '湖南话', strong: ['霸蛮', '恰饭', '嬲塞', '宝里宝气'], weak: ['咯', '哒'] },
  { region: '河南', dialect: '河南话', strong: ['弄啥嘞', '中不中', '得劲', '俺们'], weak: ['恁', '啥', '咋'] },
  { region: '山东', dialect: '山东话', strong: ['拉呱', '哈啤酒', '潮巴', '得劲'], weak: ['俺', '恁', '么'] },
  { region: '陕西', dialect: '陕西话', strong: ['嫽扎咧', '克里马擦', '咥', '谝'], weak: ['额', '咋', '咧'] },
  { region: '云南', dialect: '云南话', strong: ['板扎', '给是', '整哪样'], weak: ['咋个', '咯', '甩'] },
  { region: '贵州', dialect: '贵州话', strong: ['板扎', '搞哪样'], weak: ['勒', '哦豁', '哈'] },
  { region: '广西', dialect: '广西话', strong: ['咩', '啵', '老表'], weak: ['咧', '克'] },
  { region: '福建', dialect: '闽南语', strong: ['歹势', '古早', '厝', '阮'], weak: ['食'] },
  { region: '潮汕', dialect: '潮汕话', strong: ['孥', '厝', '阮'], weak: ['好食'] },
  { region: '客家', dialect: '客家话', strong: ['涯', '食朝', '转屋卡', '你兜'], weak: [] },
  { region: '天津', dialect: '天津话', strong: ['倍儿', '哏儿', '干嘛呢'], weak: ['嘛', '介'] },
  { region: '湖北', dialect: '湖北话', strong: ['么斯', '冇得', '拐子', '闹眼子'], weak: ['蛮扎实'] },
  { region: '江西', dialect: '江西话', strong: ['恰饭', '崽里', '老表'], weak: ['冇'] },
  { region: '安徽', dialect: '安徽话', strong: ['搞么斯', '得味'], weak: ['乖乖'] },
  { region: '浙江', dialect: '吴语', strong: ['侬', '阿拉', '弗', '木佬佬'], weak: ['伐', '适意'] },
  { region: '山西', dialect: '山西话', strong: ['圪蹴', '老醯儿'], weak: ['甚'] },
  { region: '甘肃', dialect: '甘肃话', strong: ['尕', '谝'], weak: ['咋', '啥'] },
  { region: '新疆', dialect: '新疆话', strong: ['尕', '谝'], weak: ['咋', '啥'] },
  { region: '海南', dialect: '海南话', strong: ['做乜', '加咪'], weak: ['鲁'] },
];

function detectExpressionLexicon(text: string): {
  region: string;
  dialect?: string;
  expressions: string[];
  confidence: 'high' | 'medium';
} | undefined {
  let best:
    | {
        region: string;
        dialect?: string;
        expressions: string[];
        confidence: 'high' | 'medium';
        score: number;
      }
    | undefined;

  for (const entry of EXPRESSION_LEXICON) {
    const strongHits = entry.strong.filter(word => text.includes(word));
    const weakHits = (entry.weak || []).filter(word => text.includes(word));
    const expressions = Array.from(new Set([...strongHits, ...weakHits]));
    const highConfidence = strongHits.length > 0;
    if (!highConfidence && weakHits.length < 2) continue;
    const score = strongHits.length * 10 + weakHits.length;
    if (!best || score > best.score) {
      best = {
        region: entry.region,
        dialect: entry.dialect,
        expressions,
        confidence: highConfidence ? 'high' : 'medium',
        score,
      };
    }
  }

  if (!best) return undefined;
  return {
    region: best.region,
    dialect: best.dialect,
    expressions: best.expressions,
    confidence: best.confidence,
  };
}

function normalizeRegion(raw: string): string | undefined {
  let value = (raw || '').trim();
  if (!value) return undefined;
  value = value.replace(/^(?:我们|我|都|也)+/, '').trim();
  value = value.replace(/(?:省|市|自治区|特别行政区|地区)$/, '').trim();
  if (value.length < 2 || value.length > 8) return undefined;
  if (REGION_STOP.has(value)) return undefined;
  if (/^(?:哪|什么|谁|咋|怎么)/.test(value)) return undefined;
  if (!REGION_NAMES.has(value)) return undefined;
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
  if (mapped) return { dialect, region: mapped };
  const base = dialect.replace(/(?:话|语|方言)$/, '').trim();
  if (base && REGION_NAMES.has(base)) return { dialect, region: base };
  return { dialect: '' };
}

/**
 * 返回高置信的地区表达偏好；疑问、否定、假设、非地区称谓返回 undefined。
 */
export function detectRegionalExpressionPreference(
  text: string,
  options: { includeExpressions?: boolean } = {}
): RegionalExpressionPreference | undefined {
  const value = (text || '').replace(/\s+/g, ' ').trim();
  if (!value || value.length > 400) return undefined;
  if (QUESTION_OR_HYPOTHETICAL.test(value)) return undefined;
  if (NEGATION.test(value)) return undefined;

  const dialectMatch = DIALECT_PATTERN.exec(value);
  if (dialectMatch) {
    const before = value.slice(
      Math.max(0, dialectMatch.index - 16),
      dialectMatch.index
    );
    const thirdPartySubject =
      /(?:妈妈|妈|爸爸|爸|婆婆|公公|奶奶|爷爷|外婆|外公|他|她|他们|她们|别人)/;
    const selfOrAgent = /(?:我|你|您|我们)/;
    if (thirdPartySubject.test(before) && !selfOrAgent.test(before)) {
      return undefined;
    }
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

  for (const pattern of USER_PATTERNS) {
    const match = pattern.exec(value);
    if (!match) continue;
    const region = normalizeRegion(match[1]);
    if (region) {
      return {
        region,
        source: 'user',
        matched: match[0],
        value: `用户希望沿用${region}地区的表达习惯交流`,
        confidence: 'high',
      };
    }
  }

  if (options.includeExpressions !== false) {
    const expression = detectExpressionLexicon(value);
    if (expression?.confidence === 'high') {
      return {
        region: expression.region,
        dialect: expression.dialect,
        source: 'expression',
        matched: expression.expressions.join('、'),
        expressions: expression.expressions,
        confidence: expression.confidence,
        // value 必须稳定：不能把每次命中的具体词写进常驻值，否则永远无法累计证据。
        value: `用户希望沿用${expression.region}地区的表达习惯交流；自然使用，不要每句堆地方词。`,
      };
    }
  }

  return undefined;
}
