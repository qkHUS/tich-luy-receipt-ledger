import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('HTML exposes the accessible controls used by the application', async () => {
  const html = await readFile(join(ROOT, 'src', 'index.html'), 'utf8');
  assert.match(html, /<main id="main-content"[^>]+tabindex="-1"/);
  assert.match(html, /id="import-trigger"[^>]+type="button"/);
  assert.match(html, /id="camera-input"[^>]+capture="environment"/);
  assert.match(html, /id="ocr-progressbar"[^>]+role="progressbar"/);
  assert.match(html, /id="ocr-progressbar"[^>]+aria-valuemin="0"/);
  assert.match(html, /id="ocr-progressbar"[^>]+aria-valuemax="100"/);
  assert.match(html, /id="confirm-dialog"[^>]+aria-labelledby="confirm-title"/);
  assert.match(html, /id="confirm-dialog"[^>]+aria-describedby="confirm-message"/);
  assert.doesNotMatch(html, /class="brand"[^>]+aria-label=/);
  assert.doesNotMatch(html, /https?:\/\//i);
});

test('application IDs referenced by JavaScript exist in the HTML', async () => {
  const html = await readFile(join(ROOT, 'src', 'index.html'), 'utf8');
  const source = await readFile(join(ROOT, 'src', 'app.js'), 'utf8');
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const referencedIds = [...source.matchAll(/byId\('([^']+)'\)/g)].map((match) => match[1]);
  for (const id of referencedIds) assert.ok(htmlIds.has(id), `Missing HTML id: ${id}`);
});

test('application only pre-fills totals backed by an explicit high-confidence label', async () => {
  const source = await readFile(join(ROOT, 'src', 'app.js'), 'utf8');
  assert.match(source, /function getFieldConfidence\(/);
  assert.doesNotMatch(source, /function fieldConfidence\(/);
  assert.match(source, /getFieldConfidence\(parsed, 'total'\) >= 0\.9/);
});

test('backup import failures are reported in user-friendly Vietnamese', async () => {
  const source = await readFile(join(ROOT, 'src', 'app.js'), 'utf8');
  assert.match(source, /function backupErrorMessage\(/);
  assert.match(source, /error\?\.code === 'INVALID_JSON'/);
  assert.match(source, /error\?\.code === 'INVALID_BACKUP_TYPE'/);
  assert.doesNotMatch(source, /error\?\.message \|\| 'Không thể nhập sao lưu\.'/);
});

test('service worker uses a relative scope and contains only local resources', async () => {
  const source = await readFile(join(ROOT, 'src', 'sw.js'), 'utf8');
  assert.match(source, /'\.\/index\.html'/);
  assert.match(source, /'\.\/assets\/app\.js'/);
  assert.doesNotMatch(source, /https?:\/\//i);
});
