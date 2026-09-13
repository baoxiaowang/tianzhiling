import { matchAllGlobal } from '../agents/memory-value';
import { HABIT_TOPIC_KEYS } from '../agents/memory-topics';

/**
 * 检索键抽取：从用户这一轮原话抽出人物/时间/事件/话题键。
 * 这里只做抽取，不做过滤判定；过滤与人物对齐属于策略层。
 */

const KINSHIP_LIKE_TERMS = [
  '妈',
  '爸',
  '爹',
  '娘',
  '哥',
  '姐',
  '弟',
  '妹',
  '爸爸',
  '妈妈',
  '父亲',
  '母亲',
  '爷爷',
  '奶奶',
  '外公',
  '外婆',
  '姥姥',
  '姥爷',
  '哥哥',
  '姐姐',
  '弟弟',
  '妹妹',
  '儿子',
  '女儿',
  '孩子',
  '孙子',
  '孙女',
  '外孙',
  '外孙女',
  '丈夫',
  '妻子',
  '老公',
  '老婆',
  '舅舅',
  '叔叔',
  '伯伯',
  '姑姑',
  '姨妈',
  '阿姨',
  '嫂子',
  '女婿',
  '儿媳',
];

/**
 * 把用户这一轮原话抽成检索键：人物/时间/事件词，用它们去检索，
 * 而不是拿整句情绪原话撞相似度（那样只会捞回情绪与问句）。抽不出键就不检索。
 */
export function buildMemoryRetrievalQuery(query: string): string {
  const text = (query || '').trim();
  if (!text) return '';
  const keys = new Set<string>();
  for (const term of KINSHIP_LIKE_TERMS) {
    if (text.includes(term)) keys.add(term);
  }
  for (const match of matchAllGlobal(
    text,
    /\d{1,4}\s*(?:年|月|日|号|岁|天)|[一二三四五六七八九十]{1,3}\s*(?:年|月|日|岁|天)|以前|当年|小时候|上个月|去年|今年|多久/gu
  ))
    keys.add(match[0].replace(/\s+/g, ''));
  for (const match of matchAllGlobal(
    text,
    /去世|过世|离世|走了|走后|走的时候|离开|住院|手术|生病|结婚|离婚|怀孕|出生|上学|幼儿园|工作|上班|搬家|买房|纪念日|生日|忌日|祭日|走/gu
  ))
    keys.add(match[0]);
  // 生活习惯/身体类话题：用户常换着说法讲同一件事（"没抽""一颗烟都没有抽""又捡起来了"），
  // 统一归到一个话题键去检索，否则按字面词根本找不到同一件事的其他说法。
  for (const [pattern, key] of HABIT_TOPIC_KEYS) {
    if (pattern.test(text)) keys.add(key);
  }
  return [...keys].join(' ');
}
