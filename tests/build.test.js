import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('PWA manifest declares installability and relative scope', async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, 'src', 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'Tích Lũy — AI Receipt Ledger');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
});

test('workflow deploys the static build to GitHub Pages', async () => {
  const workflow = await readFile(join(ROOT, '.github', 'workflows', 'deploy-pages.yml'), 'utf8');
  assert.match(workflow, /actions\/configure-pages@v5/);
  assert.match(workflow, /enablement:\s*true/);
  assert.match(workflow, /actions\/upload-pages-artifact@v3/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /path: dist/);
});

test('OCR language models are present locally', async () => {
  for (const file of ['vie.traineddata.gz', 'eng.traineddata.gz']) {
    const info = await stat(join(ROOT, 'src', 'vendor', 'tessdata', file));
    assert.ok(info.size > 1_000_000, `${file} appears incomplete`);
  }
});

test('service worker precaches the local OCR runtime and language models', async () => {
  const source = await readFile(join(ROOT, 'src', 'sw.js'), 'utf8');
  assert.match(source, /tesseract-core-simd-lstm\.wasm\.js/);
  assert.match(source, /vie\.traineddata\.gz/);
  assert.match(source, /eng\.traineddata\.gz/);
  assert.match(source, /cache:\s*'reload'/);
});

test('OCR pins the same local core that the service worker precaches', async () => {
  const source = await readFile(join(ROOT, 'src', 'ocr.js'), 'utf8');
  assert.match(source, /tesseract-core-simd-lstm\.wasm\.js/);
  assert.match(source, /cacheMethod:\s*'none'/);
  assert.doesNotMatch(source, /assetUrl\('\.\/vendor\/core\/'\)/);
});

test('static build includes crawler directives and third-party license', async () => {
  const robots = await readFile(join(ROOT, 'src', 'robots.txt'), 'utf8');
  const build = await readFile(join(ROOT, 'scripts', 'build.mjs'), 'utf8');
  assert.match(robots, /User-agent:\s*\*/);
  assert.match(robots, /Allow:\s*\//);
  assert.match(build, /\['robots\.txt', 'robots\.txt'\]/);
});

test('third-party Apache license is bundled with the static build', async () => {
  const license = await readFile(join(ROOT, 'third_party', 'APACHE-2.0.txt'), 'utf8');
  const build = await readFile(join(ROOT, 'scripts', 'build.mjs'), 'utf8');
  assert.match(license, /Apache License/);
  assert.match(build, /APACHE-2\.0\.txt/);
  assert.match(build, /THIRD_PARTY_NOTICES\.md/);
});

test('runtime source does not reference a remote URL', async () => {
  for (const file of ['app.js', 'categories.js', 'ocr.js', 'parser.js', 'storage.js', 'sw.js']) {
    const source = await readFile(join(ROOT, 'src', file), 'utf8');
    assert.doesNotMatch(source, /https?:\/\//i, `${file} must remain offline-only`);
  }
});
