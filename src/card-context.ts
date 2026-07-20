const SECTION_NAMES: Record<string, string> = {
  prefix: '字首',
  root: '字根',
  suffix: '字尾',
};

export function displaySectionName(section: string | null): string {
  if (!section) return '自訂';
  return SECTION_NAMES[section] ?? section;
}
