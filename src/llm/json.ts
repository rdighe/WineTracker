/** Pull the first JSON object/array out of a model reply that may have prose or code fences around it. */
export function extractJson(text: string, kind: 'object' | 'array'): unknown | null {
  const re = kind === 'object' ? /\{[\s\S]*\}/ : /\[[\s\S]*\]/;
  const m = String(text ?? '').match(re);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}
