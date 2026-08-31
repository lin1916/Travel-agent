import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = process.argv.slice(2);
const patterns = [
  /\b\d{17}[\dXx]\b/,
  /\b1[3-9]\d{9}\b/,
  /\b(?:\d[ -]?){13,19}\b/,
  /\bBearer\s+[A-Za-z0-9._~-]{20,}\b/i,
  /\beyJ[A-Za-z0-9_-]{20,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const ignored = /(^|[\\/])(node_modules|dist|test-results)([\\/]|$)|\.(test|spec)\.[^.]+$/;
const matches = [];
function walk(path) {
  if (ignored.test(path)) return;
  const info = statSync(path);
  if (info.isDirectory()) {
    for (const entry of readdirSync(path)) walk(join(path, entry));
    return;
  }
  if (!/\.(c?m?[jt]s|json|ya?ml|md|env|txt)$/i.test(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const pattern of patterns) if (pattern.test(text)) matches.push(`${path}: ${pattern}`);
}
for (const root of roots.length ? roots : ['apps', 'packages']) walk(root);
if (matches.length) {
  console.error(matches.join('\n'));
  process.exit(1);
}
