import { access, copyFile, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');
const NODE_MODULES = join(ROOT, 'node_modules');

const staticFiles = [
  ['index.html', 'index.html'],
  ['styles.css', 'assets/styles.css'],
  ['app.js', 'assets/app.js'],
  ['categories.js', 'assets/categories.js'],
  ['ocr.js', 'assets/ocr.js'],
  ['parser.js', 'assets/parser.js'],
  ['storage.js', 'assets/storage.js'],
  ['manifest.webmanifest', 'manifest.webmanifest'],
  ['robots.txt', 'robots.txt'],
  ['sw.js', 'sw.js'],
  ['icons/icon.svg', 'icons/icon.svg'],
  ['icons/icon-192.png', 'icons/icon-192.png'],
  ['icons/icon-512.png', 'icons/icon-512.png'],
  ['icons/icon-maskable-512.png', 'icons/icon-maskable-512.png'],
  ['vendor/tessdata/vie.traineddata.gz', 'assets/vendor/tessdata/vie.traineddata.gz'],
  ['vendor/tessdata/eng.traineddata.gz', 'assets/vendor/tessdata/eng.traineddata.gz'],
];

// The supported-browser matrix all provides WebAssembly SIMD. The matching
// self-contained core is pinned in ocr.js and precached for offline OCR.
const coreFiles = ['tesseract-core-simd-lstm.wasm.js'];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function copyIfPresent(from, to) {
  if (!(await exists(from))) throw new Error(`Thiếu tài nguyên build: ${relative(ROOT, from)}`);
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  for (const [from, to] of staticFiles) {
    await copyIfPresent(join(SRC, from), join(DIST, to));
  }

  await copyIfPresent(
    join(NODE_MODULES, 'tesseract.js', 'dist', 'tesseract.esm.min.js'),
    join(DIST, 'assets', 'vendor', 'tesseract.esm.min.js'),
  );
  await copyIfPresent(
    join(NODE_MODULES, 'tesseract.js', 'dist', 'worker.min.js'),
    join(DIST, 'assets', 'vendor', 'worker.min.js'),
  );
  await copyIfPresent(
    join(ROOT, 'THIRD_PARTY_NOTICES.md'),
    join(DIST, 'THIRD_PARTY_NOTICES.md'),
  );
  await copyIfPresent(
    join(ROOT, 'third_party', 'APACHE-2.0.txt'),
    join(DIST, 'third_party', 'APACHE-2.0.txt'),
  );
  for (const file of ['tesseract.esm.min.js.map', 'worker.min.js.map']) {
    await copyIfPresent(
      join(NODE_MODULES, 'tesseract.js', 'dist', file),
      join(DIST, 'assets', 'vendor', file),
    );
  }

  for (const file of coreFiles) {
    await copyIfPresent(
      join(NODE_MODULES, 'tesseract.js-core', file),
      join(DIST, 'assets', 'vendor', 'core', file),
    );
  }

  // Version the service-worker cache from the app-shell contents so a deploy
  // invalidates stale JavaScript without relying on a hand-edited counter.
  const swPath = join(DIST, 'sw.js');
  const swSource = await readFile(swPath, 'utf8');
  const hash = createHash('sha256');
  hash.update(swSource);
  for (const file of [
    'index.html',
    'manifest.webmanifest',
    'assets/styles.css',
    'assets/app.js',
    'assets/categories.js',
    'assets/ocr.js',
    'assets/parser.js',
    'assets/storage.js',
    'assets/vendor/tesseract.esm.min.js',
    'assets/vendor/worker.min.js',
    'assets/vendor/core/tesseract-core-simd-lstm.wasm.js',
    'assets/vendor/tessdata/vie.traineddata.gz',
    'assets/vendor/tessdata/eng.traineddata.gz',
    'icons/icon.svg',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png',
  ]) {
    hash.update(await readFile(join(DIST, file)));
  }
  const cacheVersion = `tich-luy-${hash.digest('hex').slice(0, 12)}`;
  const versionQuery = `?v=${cacheVersion}`;

  // Cache-bust the entry points and ES-module graph. This prevents a browser
  // HTTP cache from mixing a new app.js with an old dependency during the
  // first visit immediately after a deployment.
  const htmlPath = join(DIST, 'index.html');
  let htmlSource = await readFile(htmlPath, 'utf8');
  for (const path of ['./assets/styles.css', './assets/app.js']) {
    htmlSource = htmlSource.replaceAll(path, `${path}${versionQuery}`);
  }
  await writeFile(htmlPath, htmlSource, 'utf8');

  const appPath = join(DIST, 'assets', 'app.js');
  let appSource = await readFile(appPath, 'utf8');
  for (const path of ['./categories.js', './ocr.js', './parser.js', './storage.js']) {
    appSource = appSource.replaceAll(`'${path}'`, `'${path}${versionQuery}'`);
  }
  await writeFile(appPath, appSource, 'utf8');

  const ocrPath = join(DIST, 'assets', 'ocr.js');
  let ocrSource = await readFile(ocrPath, 'utf8');
  for (const path of ['./vendor/tesseract.esm.min.js', './vendor/worker.min.js']) {
    ocrSource = ocrSource.replaceAll(`'${path}'`, `'${path}${versionQuery}'`);
  }
  await writeFile(ocrPath, ocrSource, 'utf8');

  const versionedShellPaths = [
    './assets/styles.css',
    './assets/app.js',
    './assets/categories.js',
    './assets/ocr.js',
    './assets/parser.js',
    './assets/storage.js',
    './assets/vendor/tesseract.esm.min.js',
    './assets/vendor/worker.min.js',
  ];
  let transformedSwSource = swSource;
  for (const path of versionedShellPaths) {
    transformedSwSource = transformedSwSource.replaceAll(`'${path}'`, `'${path}${versionQuery}'`);
  }
  transformedSwSource = transformedSwSource.replace(
    /const VERSION = '[^']+';/u,
    `const VERSION = '${cacheVersion}';`,
  );

  const appShellBlock = transformedSwSource.match(/const APP_SHELL = \[([\s\S]*?)\];/u)?.[1] ?? '';
  const precachedPaths = [...appShellBlock.matchAll(/'([^']+)'/gu)].map((match) => match[1]);
  for (const path of precachedPaths) {
    if (path === './') continue;
    const relativePath = path.replace(/^\.\//u, '').split('?')[0];
    if (!(await exists(join(DIST, relativePath)))) {
      throw new Error(`Service worker precache thiếu asset: ${path}`);
    }
  }
  await writeFile(swPath, transformedSwSource, 'utf8');

  // GitHub Pages normally serves these files directly. `.nojekyll` prevents a
  // Jekyll build from discarding directories that begin with an underscore.
  await writeFile(join(DIST, '.nojekyll'), '', 'utf8');

  // A copy makes direct visits to a missing route fall back to the PWA shell.
  await copyFile(join(DIST, 'index.html'), join(DIST, '404.html'));

  const html = await readFile(join(DIST, 'index.html'), 'utf8');
  const externalRuntimeUrls = [...html.matchAll(/(?:src|href)=["'](https?:\/\/[^"']+)/gi)]
    .map((match) => match[1]);
  if (externalRuntimeUrls.length > 0) {
    throw new Error(`HTML chứa tài nguyên ngoài: ${externalRuntimeUrls.join(', ')}`);
  }

  const runtimeFiles = [
    'assets/app.js',
    'assets/ocr.js',
    'assets/parser.js',
    'assets/storage.js',
    'sw.js',
  ];
  for (const file of runtimeFiles) {
    const source = await readFile(join(DIST, file), 'utf8');
    if (/https?:\/\//i.test(source)) {
      throw new Error(`${file} chứa URL mạng; bản runtime phải hoạt động hoàn toàn offline.`);
    }
  }

  const manifest = JSON.parse(await readFile(join(DIST, 'manifest.webmanifest'), 'utf8'));
  if (!manifest.icons?.length || !manifest.start_url || !manifest.scope) {
    throw new Error('Manifest PWA không hợp lệ.');
  }

  const indexStat = await stat(join(DIST, 'index.html'));
  if (indexStat.size < 1000) throw new Error('index.html có vẻ bị cắt cụt.');
}

main().catch((error) => {
  console.error(`Build thất bại: ${error.message}`);
  process.exitCode = 1;
});
