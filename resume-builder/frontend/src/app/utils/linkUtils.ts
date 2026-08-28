export const formatHref = (val?: string, type: 'url' | 'email' | 'phone' = 'url'): string => {
  if (!val) return '#';
  const trimmed = val.trim();
  if (type === 'email') return `mailto:${trimmed}`;
  if (type === 'phone') return `tel:${trimmed.replace(/[^\d+]/g, '')}`;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
};
