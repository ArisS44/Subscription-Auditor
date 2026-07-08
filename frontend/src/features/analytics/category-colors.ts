// Fixed category → color mapping. Color follows the entity (a category is always
// the same hue across every chart type), using the design system's categorical
// --chart-* slots (CVD-validated in light and dark; see src/index.css). Charts
// always render category labels, which is the required secondary encoding so
// identity is never colour-alone.
export const CATEGORY_COLOR: Record<string, string> = {
  ai_tool: 'var(--chart-1)',
  streaming: 'var(--chart-2)',
  productivity: 'var(--chart-3)',
  cloud_storage: 'var(--chart-4)',
  other: 'var(--chart-5)',
};

export function categoryColor(category: string): string {
  return CATEGORY_COLOR[category] ?? 'var(--chart-5)';
}
