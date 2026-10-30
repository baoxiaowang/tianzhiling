export interface PersonAddressNameSet {
  preferredName?: string;
  realName?: string;
  aliases?: string[];
  relationToUser?: string;
}

/**
 * 程序选称呼：用户本轮提到哪个已确认名字，就用哪个；否则用默认称呼。
 * 这里只处理“有效名字”，不处理 ASR 变体；rejected 变体由 name variant 映射拦截。
 */
export function selectProgrammaticAddress(
  person: PersonAddressNameSet,
  mentionText: string
): string | undefined {
  const preferred = person.preferredName?.trim();
  const realName = person.realName?.trim();
  const aliases = (person.aliases || []).map(name => name.trim()).filter(Boolean);
  const relation = person.relationToUser?.trim();
  const names = [preferred, realName, ...aliases, relation].filter(
    (name): name is string => Boolean(name)
  );
  const normalizedMention = mentionText || '';
  const mentioned = names.find(name => normalizedMention.includes(name));
  if (mentioned) return mentioned;

  const relationSynonyms: Record<string, string[]> = {
    女儿: ['闺女', '女儿', '孩子'],
    儿子: ['儿子', '小子', '孩子'],
    妈妈: ['妈妈', '妈'],
    爸爸: ['爸爸', '爸'],
  };
  if (relation) {
    const synonym = (relationSynonyms[relation] || []).find(term =>
      normalizedMention.includes(term)
    );
    if (synonym) return synonym;
  }

  return preferred || realName || aliases[0] || relation;
}
