const OCR_LANGUAGES = 'vie+eng';
const OCR_OEM_LSTM_ONLY = 1;

let workerPromise = null;
let activeWorker = null;
let activeRun = 0;
let cancelledRun = 0;

function assetUrl(path) {
  return new URL(path, import.meta.url).href;
}

function progressLabel(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('language')) return 'Đang tải bộ nhận dạng Việt–Anh…';
  if (normalized.includes('core')) return 'Đang khởi tạo bộ xử lý ảnh…';
  if (normalized.includes('recogniz')) return 'Đang đọc chữ trên hóa đơn…';
  if (normalized.includes('initializ')) return 'Đang chuẩn bị OCR…';
  return 'Đang xử lý hóa đơn…';
}

/**
 * Nhận diện chữ hoàn toàn trong trình duyệt.
 *
 * Mọi URL đều là tương đối để hoạt động trên GitHub Pages theo đường dẫn
 * `/<repo>/` và không gọi ra CDN lúc chạy.
 */
export async function recognizeReceipt(image, onProgress = () => {}) {
  const run = ++activeRun;
  cancelledRun = 0;

  if (activeWorker) {
    await activeWorker.terminate().catch(() => {});
    activeWorker = null;
  }
  if (workerPromise) {
    workerPromise.then((worker) => worker.terminate()).catch(() => {});
    workerPromise = null;
  }

  const report = (progress = 0, status = 'Đang xử lý hóa đơn…', detail = '') => {
    if (run !== activeRun || run === cancelledRun) return;
    onProgress({
      progress: Math.max(0, Math.min(1, Number(progress) || 0)),
      status: progressLabel(status),
      detail,
    });
  };

  report(0.03, 'initializing tesseract', 'Khởi tạo bộ xử lý ảnh');

  const tesseractModule = await import('./vendor/tesseract.esm.min.js');
  const createWorker = tesseractModule.createWorker || tesseractModule.default?.createWorker;
  if (typeof createWorker !== 'function') {
    throw new Error('Không thể nạp bộ xử lý OCR cục bộ.');
  }
  const pendingWorker = createWorker(OCR_LANGUAGES, OCR_OEM_LSTM_ONLY, {
    workerPath: assetUrl('./vendor/worker.min.js'),
    // All supported browsers expose WebAssembly SIMD. Pinning the matching
    // self-contained core avoids an implicit CDN fallback and keeps the
    // service-worker precache deterministic.
    corePath: assetUrl('./vendor/core/tesseract-core-simd-lstm.wasm.js'),
    langPath: assetUrl('./vendor/tessdata/'),
    gzip: true,
    // The service worker already precaches the compressed models. Avoid a
    // second, decompressed copy in IndexedDB (about 31 MB for Việt–Anh).
    cacheMethod: 'none',
    logger: (event) => {
      const status = event?.status || 'processing';
      const progress = typeof event?.progress === 'number' ? event.progress : 0;
      report(progress * 0.72, status, 'Tài nguyên OCR đang được lưu cục bộ để dùng offline');
    },
  });

  workerPromise = pendingWorker;
  pendingWorker
    .then((worker) => {
      workerPromise = null;
      if (run !== activeRun || run === cancelledRun) {
        worker.terminate().catch(() => {});
        return;
      }
      activeWorker = worker;
    })
    .catch(() => {
      if (workerPromise === pendingWorker) workerPromise = null;
    });

  let worker;
  try {
    worker = await pendingWorker;
  } catch (error) {
    if (run === cancelledRun) throw new DOMException('OCR đã được hủy', 'AbortError');
    throw error;
  }

  if (run !== activeRun || run === cancelledRun) {
    await worker.terminate().catch(() => {});
    throw new DOMException('OCR đã được hủy', 'AbortError');
  }

  try {
    report(0.76, 'recognizing text', 'Đọc chữ và nhận diện các trường dữ liệu');
    const result = await worker.recognize(image, {}, { text: true, blocks: true });
    if (run !== activeRun || run === cancelledRun) {
      throw new DOMException('OCR đã được hủy', 'AbortError');
    }
    report(1, 'complete', 'Hoàn tất');
    return {
      text: result?.data?.text || '',
      confidence: Number(result?.data?.confidence ?? 0),
      blocks: result?.data?.blocks || [],
    };
  } finally {
    if (activeWorker === worker) {
      await worker.terminate().catch(() => {});
      activeWorker = null;
    }
  }
}

/** Hủy lượt OCR hiện tại; lượt cũ sẽ bị bỏ qua kể cả khi worker khởi tạo xong. */
export function cancelOCR() {
  const run = activeRun;
  cancelledRun = run;
  activeRun += 1;

  if (activeWorker) {
    const worker = activeWorker;
    activeWorker = null;
    worker.terminate().catch(() => {});
  }
  if (workerPromise) {
    workerPromise.then((worker) => worker.terminate()).catch(() => {});
    workerPromise = null;
  }
}

export function isOCRActive() {
  return Boolean(activeWorker || workerPromise);
}
