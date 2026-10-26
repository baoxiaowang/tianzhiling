export interface FamilyFactLike {
  key: string;
}

export interface FamilySummaryFilterResult<T extends FamilyFactLike> {
  facts: T[];
  logs: string[];
}

/**
 * 摘要与事实对账：摘要明确“只有一个儿子/女儿”时，不再注入对立性别的事实；
 * 摘要只说“一个孩子/娃”时只记冲突日志，不擅自删事实。
 */
export function filterFamilyFactsByContinuitySummary<T extends FamilyFactLike>(
  facts: T[],
  summary?: string
): FamilySummaryFilterResult<T> {
  const text = (summary || '').replace(/\s+/g, '');
  if (!text) return { facts, logs: [] };

  const onlySon =
    /只有一个(?:儿子|男孩)/.test(text) ||
    /只有.{0,12}一个(?:儿子|男孩)/.test(text);
  const onlyDaughter =
    /只有一个(?:女儿|女孩)/.test(text) ||
    /只有.{0,12}一个(?:女儿|女孩)/.test(text);
  const oneChild =
    /只有一个(?:孩子|娃)/.test(text) ||
    /只有.{0,12}一个(?:孩子|娃)/.test(text);

  const logs: string[] = [];
  if (!onlySon && !onlyDaughter) {
    if (oneChild) {
      const hasSon = facts.some(fact =>
        /^family\.(newborn\.)?son$/.test(fact.key)
      );
      const hasDaughter = facts.some(fact =>
        /^family\.(newborn\.)?daughter$/.test(fact.key)
      );
      if (hasSon && hasDaughter) {
        logs.push(
          'summary says one child but facts contain both son and daughter'
        );
      }
    }
    return { facts, logs };
  }

  const filtered = facts.filter(fact => {
    if (onlySon && /^family\.(newborn\.)?daughter$/.test(fact.key)) {
      logs.push(`dropped daughter fact against summary: ${fact.key}`);
      return false;
    }
    if (onlyDaughter && /^family\.(newborn\.)?son$/.test(fact.key)) {
      logs.push(`dropped son fact against summary: ${fact.key}`);
      return false;
    }
    return true;
  });

  return { facts: filtered, logs };
}
