import { REQUIRED_KEYS, RECOMMENDED_KEYS } from './storage';
import type { Box } from './types';

const BUILTIN_KEYS = new Set([...REQUIRED_KEYS, ...RECOMMENDED_KEYS]);

export function findKeys(tmpl: string): Set<string> {
  const re = /\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g;
  const keys = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(tmpl)) !== null) keys.add(m[1]);
  return keys;
}

export function validateTmpl(tmpl: string, userKeys: Record<string, string>) {
  const keys = findKeys(tmpl);
  return {
    missingRequired: REQUIRED_KEYS.filter(k => !keys.has(k)),
    missingRecommended: RECOMMENDED_KEYS.filter(k => !keys.has(k)),
    undefinedKeys: [...keys].filter(k => !BUILTIN_KEYS.has(k) && !(k in userKeys)),
  };
}

export function renderTmpl(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g, (_, k) => vars[k] ?? '');
}

export function includedVersionsBlock(box: Box): string {
  const chunks: string[] = [];
  for (const v of box.versions) {
    if (!v.included || v.id === 'v0') continue;
    const pct = Math.round(v.targetPct * 100);
    chunks.push(`id: ${v.id} (${pct}% of ${v.parentId})\n${v.text}`);
  }
  return chunks.join('\n\n');
}
