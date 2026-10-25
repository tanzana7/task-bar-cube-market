export const ITEM_GRADES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Divine'] as const;
export type ItemGrade = typeof ITEM_GRADES[number];
export const ITEM_TYPES = ['Boots', 'Bracelet', 'Chest', 'Chestplate', 'Gloves', 'Helmet', 'Necklace', 'Pants', 'Ring', 'Sword'] as const;
export type ItemType = typeof ITEM_TYPES[number];
export const ITEM_QUALITIES = Array.from({ length: 19 }, (_, index) => (index + 1) * 5);

export type ItemClassification = { grade: ItemGrade | null; type: ItemType | null; quality: number | null };

const gradeRank = new Map<string, number>(ITEM_GRADES.map((grade, index) => [grade.toLocaleLowerCase('en-US'), index]));

/**
 * Steam market names are not a full game metadata feed. Only an explicit leading grade token,
 * a whole-word equipment type, and a valid trailing 5% quality step are treated as known.
 * Prefix materials such as Arcane, Rusty, or Cobalt are intentionally not mapped to grades.
 */
export function classifyItemName(name: string): ItemClassification {
  const normalized = name.trim().replace(/\s+/g, ' ');
  const gradeMatch = /^(Common|Uncommon|Rare|Epic|Legendary|Mythic|Divine)(?=\s|$)/i.exec(normalized);
  const typeMatches = Array.from(normalized.matchAll(/(?:^|\s)(Chestplate|Chest|Bracelet|Necklace|Boots|Gloves|Helmet|Pants|Ring|Sword)(?=\s|$)/gi));
  const typeMatch = typeMatches.at(-1);
  const qualityMatch = /(?:^|\s)(\d{1,2})%$/.exec(normalized);
  const qualityValue = qualityMatch ? Number(qualityMatch[1]) : null;
  const grade = gradeMatch
    ? ITEM_GRADES.find(candidate => candidate.toLocaleLowerCase('en-US') === gradeMatch[1].toLocaleLowerCase('en-US')) ?? null
    : null;
  const type = typeMatch
    ? ITEM_TYPES.find(candidate => candidate.toLocaleLowerCase('en-US') === typeMatch[1].toLocaleLowerCase('en-US')) ?? null
    : null;
  return {
    grade,
    type,
    quality: qualityValue !== null && qualityValue >= 5 && qualityValue <= 95 && qualityValue % 5 === 0 ? qualityValue : null,
  };
}

export function gradeAtLeast(value: ItemGrade | null, minimum: ItemGrade | null): boolean {
  if (minimum === null) return true;
  if (value === null) return false;
  return (gradeRank.get(value.toLocaleLowerCase('en-US')) ?? -1) >= (gradeRank.get(minimum.toLocaleLowerCase('en-US')) ?? Infinity);
}
