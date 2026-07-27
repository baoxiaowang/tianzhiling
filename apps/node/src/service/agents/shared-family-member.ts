export interface SharedFamilyMemberDeclaration {
  name: string;
  relationship: 'son' | 'daughter' | 'child' | 'family';
  relationshipLabel: '儿子' | '女儿' | '孩子' | '家人';
}

export const SHARED_FAMILY_MEMBER_KEY_PREFIX = 'family.shared_member.';

const FAMILY_EMOTION_PATTERN =
  /想你|想您|好想|特别想|思念|舍不得|念你|哭|难过|难受|伤心|崩溃|痛苦/;

export function extractSharedFamilyMemberDeclarations(
  value: string
): SharedFamilyMemberDeclaration[] {
  const text = compact(value);
  const declarations: SharedFamilyMemberDeclaration[] = [];
  const patterns = [
    /(?:^|[，,。！？!?；;])([\u4e00-\u9fa5A-Za-z·]{1,12})(?:是|就是)(?:我们|咱们|我和你|我俩)(?:共同|两个人)?(?:的)?(?:共同的|重要的|很重要的|最重要的|关键的|共同|重要|很重要|最重要|关键)?(儿子|女儿|孩子|家人|亲人)/g,
    /(?:我们|咱们|我和你|我俩)(?:共同|两个人)?(?:的)?(?:共同的|重要的|很重要的|最重要的|关键的|共同|重要|很重要|最重要|关键)?(儿子|女儿|孩子|家人|亲人)(?:叫|名字叫|小名叫|昵称是)([\u4e00-\u9fa5A-Za-z·]{1,12})/g,
    /(?:我们|咱们|我和你|我俩)(?:还)?有(?:一个|个|一位)?(儿子|女儿|孩子)(?:叫|名字叫|小名叫|昵称是)([\u4e00-\u9fa5A-Za-z·]{1,12})/g,
  ];

  for (const [index, pattern] of patterns.entries()) {
    for (const match of text.matchAll(pattern)) {
      const name = normalizeSharedFamilyMemberName(
        index === 0 ? match[1] : match[2]
      );
      const relationshipLabel = normalizeRelationshipLabel(
        index === 0 ? match[2] : match[1]
      );

      if (!name || !relationshipLabel) {
        continue;
      }

      declarations.push({
        name,
        relationship: relationshipKey(relationshipLabel),
        relationshipLabel,
      });
    }
  }

  const byName = new Map<string, SharedFamilyMemberDeclaration>();

  for (const declaration of declarations) {
    byName.set(declaration.name, declaration);
  }

  return [...byName.values()];
}

export function buildSharedFamilyMemberFactKey(name: string): string {
  return `${SHARED_FAMILY_MEMBER_KEY_PREFIX}${normalizeSharedFamilyMemberName(
    name
  )}`;
}

export function getSharedFamilyMemberNameFromFactKey(
  key: string
): string | null {
  if (!key?.startsWith(SHARED_FAMILY_MEMBER_KEY_PREFIX)) {
    return null;
  }

  return (
    normalizeSharedFamilyMemberName(
      key.slice(SHARED_FAMILY_MEMBER_KEY_PREFIX.length)
    ) || null
  );
}

export function stripKnownFamilyMemberEmotionClauses(
  value: string,
  memberNames: string[]
): string {
  const names = normalizeMemberNames(memberNames);

  if (!names.length) {
    return value.trim();
  }

  return value
    .split(/[，,。！？!?；;\n]+/)
    .map(clause => clause.trim())
    .filter(Boolean)
    .filter(
      clause =>
        !isKnownFamilyMemberSubjectClause(clause, names) ||
        !FAMILY_EMOTION_PATTERN.test(clause)
    )
    .join('\n');
}

export function isEmotionAttributedOnlyToKnownFamilyMember(
  value: string,
  memberNames: string[]
): boolean {
  const names = normalizeMemberNames(memberNames);

  if (!names.length) {
    return false;
  }

  const clauses = value
    .split(/[，,。！？!?；;\n]+/)
    .map(clause => clause.trim())
    .filter(Boolean);
  const hasFamilyEmotionClause = clauses.some(
    clause =>
      isKnownFamilyMemberSubjectClause(clause, names) &&
      FAMILY_EMOTION_PATTERN.test(clause)
  );
  const remaining = stripKnownFamilyMemberEmotionClauses(value, names);

  return hasFamilyEmotionClause && !FAMILY_EMOTION_PATTERN.test(remaining);
}

export function mentionsKnownSharedFamilyMember(
  value: string,
  memberNames: string[]
): boolean {
  return normalizeMemberNames(memberNames).some(name => value.includes(name));
}

function isKnownFamilyMemberSubjectClause(
  clause: string,
  memberNames: string[]
): boolean {
  return memberNames.some(name => {
    const escapedName = escapeRegExp(name);

    return new RegExp(
      `^(?:${escapedName})(?:说|也|都|现在|最近|今天|刚刚|刚才)?`
    ).test(clause);
  });
}

function normalizeMemberNames(values: string[]): string[] {
  return Array.from(
    new Set(values.map(normalizeSharedFamilyMemberName).filter(Boolean))
  );
}

function normalizeSharedFamilyMemberName(value: string): string {
  const normalized = (value || '')
    .replace(/\s+/g, '')
    .replace(/[，,。！？!?；;：:、]+/g, '')
    .trim();

  if (
    !normalized ||
    normalized.length > 12 ||
    /^(?:我|你|您|他|她|它|我们|咱们|家人|亲人)$/.test(normalized)
  ) {
    return '';
  }

  return normalized;
}

function normalizeRelationshipLabel(
  value: string
): SharedFamilyMemberDeclaration['relationshipLabel'] | null {
  if (value === '儿子' || value === '女儿' || value === '孩子') {
    return value;
  }

  if (value === '家人' || value === '亲人') {
    return '家人';
  }

  return null;
}

function relationshipKey(
  value: SharedFamilyMemberDeclaration['relationshipLabel']
): SharedFamilyMemberDeclaration['relationship'] {
  const map: Record<
    SharedFamilyMemberDeclaration['relationshipLabel'],
    SharedFamilyMemberDeclaration['relationship']
  > = {
    儿子: 'son',
    女儿: 'daughter',
    孩子: 'child',
    家人: 'family',
  };

  return map[value];
}

function compact(value: string): string {
  return (value || '').replace(/\s+/g, '').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
