export function normalizeText(value) {
  return String(value ?? '')
    .replace(/[\uD800-\uDFFF]/g, '')
    .trim();
}

export function cleanScore(value) {
  const text = normalizeText(value);
  if (!text) return '';
  return text.replace(/[^\d.+-]/g, '');
}

export function formatDate(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('zh-CN', { hour12: false });
}
