import {
  CATEGORIES,
  PAYMENT_METHODS,
  categoryIcon,
  categoryLabel,
  normalizeCategory,
  normalizePaymentMethod,
} from './categories.js';
import { cancelOCR, recognizeReceipt } from './ocr.js';
import { parseReceipt } from './parser.js';
import { ReceiptStorage, parseBackup, serializeBackup, toCSV } from './storage.js';

const ledger = new ReceiptStorage();
const THEME_KEY = 'tich-luy.theme';
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
const VALID_CATEGORIES = new Set(Object.keys(CATEGORIES));
const VALID_PAYMENTS = new Set(Object.keys(PAYMENT_METHODS));

let deferredInstallPrompt = null;

const state = {
  records: [],
  editingId: null,
  rawText: '',
  confidence: null,
  objectUrl: null,
  isOcrBusy: false,
  ocrRunId: 0,
  lastProgressAnnouncement: 0,
};

const byId = (id) => document.getElementById(id);
const elements = {
  body: document.body,
  appStatus: byId('app-status'),
  themeToggle: byId('theme-toggle'),
  installApp: byId('install-app'),
  themeColor: document.querySelector('meta[name="theme-color"]'),
  dropZone: byId('drop-zone'),
  receiptInput: byId('receipt-input'),
  cameraInput: byId('camera-input'),
  cameraButton: byId('camera-button'),
  dropEmpty: byId('drop-empty'),
  dropPreview: byId('drop-preview'),
  receiptPreview: byId('receipt-preview'),
  previewName: byId('preview-name'),
  ocrProgress: byId('ocr-progress'),
  ocrProgressbar: byId('ocr-progressbar'),
  ocrStatus: byId('ocr-status'),
  ocrPercent: byId('ocr-percent'),
  ocrBar: byId('ocr-bar'),
  ocrDetail: byId('ocr-detail'),
  cancelOcr: byId('cancel-ocr'),
  demoButton: byId('demo-button'),
  receiptForm: byId('receipt-form'),
  formMessage: byId('form-message'),
  parseConfidence: byId('parse-confidence'),
  rawTextDetails: byId('raw-text-details'),
  rawText: byId('raw-text'),
  saveReceipt: byId('save-receipt'),
  merchant: byId('merchant'),
  receiptDate: byId('receipt-date'),
  total: byId('total'),
  vat: byId('vat'),
  invoiceNumber: byId('invoice-number'),
  paymentMethod: byId('payment-method'),
  category: byId('category'),
  note: byId('note'),
  metricSpend: byId('metric-spend'),
  metricSpendNote: byId('metric-spend-note'),
  metricVat: byId('metric-vat'),
  metricCount: byId('metric-count'),
  metricCountNote: byId('metric-count-note'),
  metricAverage: byId('metric-average'),
  chartPeriod: byId('chart-period'),
  categoryChart: byId('category-chart'),
  categoryLegend: byId('category-legend'),
  receiptList: byId('receipt-list'),
  resultsStatus: byId('results-status'),
  searchReceipts: byId('search-receipts'),
  monthFilter: byId('month-filter'),
  categoryFilter: byId('category-filter'),
  exportCsv: byId('export-csv'),
  exportJson: byId('export-json'),
  importTrigger: byId('import-trigger'),
  importJson: byId('import-json'),
  toastRegion: byId('toast-region'),
  confirmDialog: byId('confirm-dialog'),
  confirmTitle: byId('confirm-title'),
  confirmMessage: byId('confirm-message'),
  confirmAction: byId('confirm-action'),
  confirmCancel: byId('confirm-cancel'),
  reviewTitle: byId('review-title'),
};

const moneyFormatter = new Intl.NumberFormat('vi-VN', {
  style: 'currency',
  currency: 'VND',
  maximumFractionDigits: 0,
});
const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function formatMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? moneyFormatter.format(amount) : '0 ₫';
}

function formatDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthKey(value) {
  return /^\d{4}-\d{2}/.test(String(value || '')) ? String(value).slice(0, 7) : '';
}

function monthLabel(key) {
  if (!key) return 'Tất cả tháng';
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

function cleanText(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function announce(message) {
  if (!elements.appStatus) return;
  elements.appStatus.textContent = '';
  window.setTimeout(() => {
    elements.appStatus.textContent = message;
  }, 20);
}

function showToast(message, type = 'info') {
  if (!elements.toastRegion) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-notice toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const copy = document.createElement('p');
  copy.className = 'toast-message';
  copy.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Đóng thông báo');
  close.textContent = '×';
  close.addEventListener('click', () => removeToast());
  toast.append(copy, close);
  elements.toastRegion.append(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));

  const removeToast = () => {
    toast.classList.add('is-leaving');
    window.setTimeout(() => toast.remove(), 220);
  };
  window.setTimeout(removeToast, 4_500);
}

function setFormMessage(message = '', type = 'info') {
  elements.formMessage.textContent = message;
  elements.formMessage.dataset.type = type;
  elements.formMessage.setAttribute('role', type === 'error' ? 'alert' : 'status');
  elements.formMessage.classList.toggle('is-error', type === 'error');
  elements.formMessage.classList.toggle('is-success', type === 'success');
}

function showProgress(visible) {
  elements.ocrProgress.hidden = !visible;
  elements.cancelOcr.hidden = !visible;
  elements.dropZone.setAttribute('aria-busy', String(visible));
  if (visible) {
    state.lastProgressAnnouncement = 0;
    setProgress(0, 'Đang chuẩn bị OCR…', 'Khởi tạo bộ xử lý ảnh');
    announce('Đã bắt đầu OCR cục bộ.');
  }
}

function setProgress(progress, status, detail = '') {
  const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
  elements.ocrPercent.textContent = `${percent}%`;
  elements.ocrBar.style.width = `${percent}%`;
  elements.ocrStatus.textContent = status;
  elements.ocrDetail.textContent = detail;
  elements.ocrProgressbar.setAttribute('aria-valuenow', String(percent));
  elements.ocrProgressbar.setAttribute('aria-valuetext', `${status}, ${percent}%`);
  elements.ocrProgressbar.setAttribute('aria-label', 'Tiến độ OCR');
  if (percent >= state.lastProgressAnnouncement + 20 || percent === 100) {
    state.lastProgressAnnouncement = percent;
    announce(`${status}, ${percent}%.`);
  }
}

function parseField(parsed, ...names) {
  for (const name of names) {
    const value = parsed?.[name] ?? parsed?.fields?.[name];
    if (value !== undefined && value !== null && value !== '') {
      if (typeof value === 'object' && 'value' in value) return value.value;
      return value;
    }
  }
  return '';
}

function getFieldConfidence(parsed, field) {
  const confidence = parsed?.confidence;
  if (confidence === undefined || confidence === null) return 1;
  if (typeof confidence === 'number') return Number(confidence);
  const value = Number(confidence[field]);
  return Number.isFinite(value) ? value : 0;
}

function fillFormFromParsed(parsed, rawText) {
  const merchant = cleanText(parseField(parsed, 'merchant'), 240);
  const date = cleanText(parseField(parsed, 'date'), 10);
  const parsedTotal = Number(parseField(parsed, 'total', 'totalAmount'));
  // Only pre-fill totals backed by an explicit total label. Subtotals and
  // unlabelled numbers are intentionally left for the user to verify.
  const total = getFieldConfidence(parsed, 'total') >= 0.9 ? parsedTotal : Number.NaN;
  const vat = Number(parseField(parsed, 'vat', 'tax'));
  const invoiceNumber = cleanText(parseField(parsed, 'invoiceNumber', 'invoice', 'invoiceNo'), 120);
  const paymentMethod = cleanText(parseField(parsed, 'paymentMethod', 'payment'), 30);
  const category = cleanText(parseField(parsed, 'category'), 30);

  elements.merchant.value = merchant;
  elements.receiptDate.value = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDateKey();
  elements.total.value = Number.isFinite(total) && total >= 0 ? String(Math.round(total)) : '';
  elements.vat.value = Number.isFinite(vat) && vat >= 0 ? String(Math.round(vat)) : '';
  elements.invoiceNumber.value = invoiceNumber;
  elements.paymentMethod.value = VALID_PAYMENTS.has(paymentMethod) ? paymentMethod : normalizePaymentMethod(paymentMethod);
  elements.category.value = VALID_CATEGORIES.has(category) ? category : normalizeCategory(category);

  state.rawText = cleanText(parsed?.rawText ?? rawText, 20_000);
  elements.rawText.textContent = state.rawText;

  const fieldConfidence = parsed?.confidence;
  let confidence = Number(fieldConfidence);
  if (fieldConfidence && typeof fieldConfidence === 'object') {
    const direct = Number(fieldConfidence.overall ?? fieldConfidence.total ?? fieldConfidence.average ?? fieldConfidence.score);
    if (Number.isFinite(direct)) {
      confidence = direct;
    } else {
      const values = Object.values(fieldConfidence)
        .map((entry) => Number(entry?.value ?? entry?.confidence ?? entry))
        .filter(Number.isFinite);
      confidence = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN;
    }
  }
  if (Number.isFinite(confidence) && confidence > 0 && confidence <= 1) confidence *= 100;
  state.confidence = Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : null;

  if (state.confidence !== null) {
    elements.parseConfidence.hidden = false;
    elements.parseConfidence.textContent = `Tin cậy ${Math.round(state.confidence)}%`;
    elements.parseConfidence.setAttribute('aria-label', `Độ tin cậy OCR: ${Math.round(state.confidence)}%`);
  } else {
    elements.parseConfidence.hidden = true;
  }
}

function getFilteredRecords() {
  const query = elements.searchReceipts.value.trim().toLocaleLowerCase('vi');
  const month = elements.monthFilter.value;
  const category = elements.categoryFilter.value;
  return state.records.filter((record) => {
    if (month && monthKey(record.date) !== month) return false;
    if (category && record.category !== category) return false;
    if (!query) return true;
    const haystack = [record.merchant, record.notes, record.invoiceNumber, categoryLabel(record.category)]
      .join(' ')
      .toLocaleLowerCase('vi');
    return haystack.includes(query);
  });
}

function populateMonthFilter() {
  const selected = elements.monthFilter.value;
  const months = [...new Set(state.records.map((record) => monthKey(record.date)).filter(Boolean))]
    .sort((a, b) => b.localeCompare(a));
  const options = [new Option('Tất cả tháng', '')];
  for (const key of months) options.push(new Option(monthLabel(key), key));
  elements.monthFilter.replaceChildren(...options);
  if (months.includes(selected)) elements.monthFilter.value = selected;
}

function renderMetrics(records) {
  const currentMonth = localDateKey().slice(0, 7);
  const monthRecords = records.filter((record) => monthKey(record.date) === currentMonth);
  const spend = monthRecords.reduce((sum, record) => sum + record.total, 0);
  const vat = monthRecords.reduce((sum, record) => sum + record.vat, 0);
  const average = monthRecords.length ? spend / monthRecords.length : 0;

  elements.metricSpend.textContent = formatMoney(spend);
  elements.metricVat.textContent = formatMoney(vat);
  elements.metricCount.textContent = String(monthRecords.length);
  elements.metricAverage.textContent = formatMoney(average);
  elements.metricSpendNote.textContent = monthRecords.length
    ? `${monthRecords.length} hóa đơn trong tháng này`
    : 'Chưa có hóa đơn';
  elements.metricCountNote.textContent = state.records.length
    ? `${state.records.length} hóa đơn đã lưu`
    : 'Sẵn sàng nhận';
}

function renderChart(records) {
  const totals = new Map();
  for (const record of records) {
    totals.set(record.category, (totals.get(record.category) || 0) + record.total);
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, amount]) => sum + amount, 0);

  elements.categoryChart.replaceChildren();
  elements.categoryLegend.replaceChildren();

  if (!sorted.length || total <= 0) {
    elements.categoryLegend.hidden = true;
    const empty = document.createElement('p');
    empty.className = 'chart-empty';
    empty.textContent = 'Chưa có chi phí để hiển thị.';
    elements.categoryChart.append(empty);
    elements.categoryChart.setAttribute('aria-label', 'Biểu đồ phân bổ chi phí: chưa có dữ liệu');
    elements.chartPeriod.textContent = 'Chưa có dữ liệu';
    return;
  }

  const bars = document.createElement('div');
  bars.className = 'category-bars';
  for (const [category, amount] of sorted) {
    const percent = Math.round((amount / total) * 100);
    const row = document.createElement('div');
    row.className = `category-row ${category}`;

    const name = document.createElement('span');
    name.className = 'category-label';
    name.textContent = `${categoryIcon(category)} ${categoryLabel(category)}`;

    const value = document.createElement('strong');
    value.className = 'category-value';
    value.textContent = `${formatMoney(amount)} · ${percent}%`;

    const track = document.createElement('div');
    track.className = 'category-track';
    track.setAttribute('role', 'meter');
    track.setAttribute('aria-label', `${categoryLabel(category)}: ${formatMoney(amount)}, ${percent}%`);
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', String(percent));
    const bar = document.createElement('span');
    bar.className = 'category-fill';
    bar.style.setProperty('--bar-width', `${percent}%`);
    track.append(bar);

    row.append(name, value, track);
    bars.append(row);
  }
  elements.categoryChart.append(bars);
  elements.categoryLegend.hidden = false;
  elements.categoryChart.setAttribute(
    'aria-label',
    `Biểu đồ phân bổ chi phí theo nhóm, tổng ${formatMoney(total)}`,
  );

  for (const [category, amount] of sorted) {
    const item = document.createElement('div');
    item.className = `category-legend-item ${category}`;
    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'legend-label';
    label.textContent = categoryLabel(category);
    const value = document.createElement('strong');
    value.className = 'legend-value';
    value.textContent = formatMoney(amount);
    item.append(dot, label, value);
    elements.categoryLegend.append(item);
  }
}

function createReceiptCard(record) {
  const article = document.createElement('article');
  article.className = 'receipt-item';
  article.dataset.recordId = record.id;
  article.setAttribute('role', 'listitem');

  const main = document.createElement('div');
  main.className = 'receipt-info';

  const icon = document.createElement('span');
  icon.className = 'empty-icon receipt-category-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = categoryIcon(record.category);

  const copy = document.createElement('div');
  copy.className = 'receipt-copy';
  const heading = document.createElement('h3');
  heading.className = 'receipt-merchant';
  heading.textContent = record.merchant || 'Hóa đơn chưa có tên';
  const meta = document.createElement('p');
  meta.className = 'receipt-meta';
  const date = document.createElement('span');
  date.textContent = formatDate(record.date);
  const separator = document.createElement('span');
  separator.setAttribute('aria-hidden', 'true');
  separator.textContent = '•';
  const category = document.createElement('span');
  category.className = 'receipt-category';
  category.textContent = categoryLabel(record.category);
  meta.append(date, separator, category);
  copy.append(heading, meta);

  main.append(icon, copy);

  const right = document.createElement('div');
  right.className = 'receipt-right';
  const amount = document.createElement('strong');
  amount.className = 'receipt-amount';
  amount.textContent = formatMoney(record.total);
  const actions = document.createElement('div');
  actions.className = 'receipt-actions';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'button button-small button-ghost receipt-edit';
  edit.textContent = 'Sửa';
  edit.setAttribute('aria-label', `Sửa hóa đơn ${record.merchant || record.date}`);
  edit.addEventListener('click', () => beginEdit(record));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'button button-small button-danger-ghost receipt-delete';
  remove.textContent = 'Xóa';
  remove.setAttribute('aria-label', `Xóa hóa đơn ${record.merchant || record.date}`);
  remove.addEventListener('click', () => deleteRecord(record));

  actions.append(edit, remove);
  right.append(amount, actions);
  article.append(main, right);

  if (record.notes || record.invoiceNumber) {
    const details = document.createElement('p');
    details.className = 'receipt-details';
    details.textContent = [record.invoiceNumber ? `Số hóa đơn: ${record.invoiceNumber}` : '', record.notes]
      .filter(Boolean)
      .join(' · ');
    article.append(details);
  }
  return article;
}

function renderReceiptList(records) {
  elements.receiptList.replaceChildren();
  elements.receiptList.setAttribute('role', 'list');
  elements.receiptList.setAttribute('aria-label', 'Danh sách hóa đơn');
  if (!records.length) {
    const empty = document.createElement('div');
    empty.className = 'receipt-empty';
    const icon = document.createElement('span');
    icon.className = 'empty-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '🧾';
    const title = document.createElement('strong');
    title.textContent = state.records.length ? 'Không có kết quả phù hợp' : 'Sổ chi đang trống';
    const text = document.createElement('p');
    text.textContent = state.records.length
      ? 'Thử đổi bộ lọc hoặc từ khóa tìm kiếm.'
      : 'Dùng hóa đơn mẫu để khám phá, hoặc chụp hóa đơn của bạn.';
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'button button-ghost';
    action.textContent = state.records.length ? 'Xóa bộ lọc' : 'Dùng hóa đơn mẫu';
    action.addEventListener('click', () => {
      if (state.records.length) clearFilters();
      else loadDemoReceipt();
    });
    empty.append(icon, title, text, action);
    elements.receiptList.append(empty);
    return;
  }

  for (const record of records) elements.receiptList.append(createReceiptCard(record));
}

function render() {
  const filtered = getFilteredRecords();
  renderMetrics(state.records);
  renderChart(filtered);
  renderReceiptList(filtered);

  const month = elements.monthFilter.value;
  const category = elements.categoryFilter.value;
  const query = elements.searchReceipts.value.trim();
  const activeFilters = [
    month ? monthLabel(month) : '',
    category ? categoryLabel(category) : '',
    query ? `“${query}”` : '',
  ].filter(Boolean);
  elements.chartPeriod.textContent = activeFilters.length ? activeFilters.join(' · ') : 'Tất cả thời gian';
  elements.resultsStatus.textContent = filtered.length
    ? `Tìm thấy ${filtered.length} hóa đơn.`
    : state.records.length
      ? 'Không tìm thấy hóa đơn phù hợp.'
      : 'Sổ chi hiện chưa có hóa đơn.';
}

function clearFilters() {
  elements.searchReceipts.value = '';
  elements.monthFilter.value = '';
  elements.categoryFilter.value = '';
  render();
  elements.searchReceipts.focus();
}

function resetForm() {
  state.editingId = null;
  state.rawText = '';
  state.confidence = null;
  elements.receiptForm.reset();
  elements.receiptDate.value = localDateKey();
  elements.rawText.textContent = '';
  elements.parseConfidence.hidden = true;
  elements.saveReceipt.textContent = 'Lưu vào sổ chi';
  setFormMessage('');
}

function beginEdit(record) {
  state.editingId = record.id;
  state.rawText = record.rawText || '';
  state.confidence = Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : null;
  elements.merchant.value = record.merchant;
  elements.receiptDate.value = record.date;
  elements.total.value = String(record.total);
  elements.vat.value = String(record.vat || '');
  elements.invoiceNumber.value = record.invoiceNumber || '';
  elements.paymentMethod.value = record.paymentMethod || 'other';
  elements.category.value = record.category || 'other';
  elements.note.value = record.notes || '';
  elements.rawText.textContent = state.rawText;
  elements.parseConfidence.hidden = state.confidence === null;
  if (state.confidence !== null) {
    elements.parseConfidence.textContent = `Tin cậy ${Math.round(state.confidence)}%`;
    elements.parseConfidence.setAttribute('aria-label', `Độ tin cậy OCR: ${Math.round(state.confidence)}%`);
  }
  elements.saveReceipt.textContent = 'Cập nhật hóa đơn';
  setFormMessage('Đang chỉnh sửa một hóa đơn đã lưu.');
  byId('review-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => elements.merchant.focus(), 250);
}

async function saveReceipt(event) {
  event.preventDefault();
  if (!elements.receiptForm.reportValidity()) return;

  const total = Number(elements.total.value);
  if (!Number.isFinite(total) || total <= 0) {
    elements.total.setAttribute('aria-invalid', 'true');
    setFormMessage('Tổng thanh toán phải lớn hơn 0.', 'error');
    elements.total.focus();
    return;
  }
  elements.total.removeAttribute('aria-invalid');

  const existing = state.records.find((record) => record.id === state.editingId);
  const values = {
    merchant: elements.merchant.value.trim(),
    date: elements.receiptDate.value,
    total,
    vat: Number(elements.vat.value) || 0,
    invoiceNumber: elements.invoiceNumber.value.trim(),
    paymentMethod: elements.paymentMethod.value,
    category: elements.category.value,
    notes: elements.note.value.trim(),
    imageDataUrl: '',
  };

  try {
    if (existing) ledger.update(existing.id, values);
    else ledger.add(values);
  } catch (error) {
    const message = error?.code === 'QUOTA_EXCEEDED'
      ? 'Dung lượng trình duyệt đã đầy. Hãy xuất bản sao lưu rồi xóa bớt hóa đơn cũ.'
      : error?.message || 'Không thể lưu hóa đơn.';
    setFormMessage(message, 'error');
    showToast(message, 'error');
    return;
  }

  state.records = ledger.list({ sort: 'date-desc' });
  populateMonthFilter();
  render();
  resetForm();
  setFormMessage(existing ? 'Đã cập nhật hóa đơn.' : 'Đã lưu hóa đơn vào sổ chi.', 'success');
  showToast(existing ? 'Hóa đơn đã được cập nhật.' : 'Đã thêm hóa đơn vào sổ chi.', 'success');
}

function askConfirm(title, message, actionLabel = 'Xác nhận', cancelLabel = 'Hủy') {
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmAction.textContent = actionLabel;
  elements.confirmCancel.textContent = cancelLabel;
  return new Promise((resolve) => {
    const resolver = { resolve };
    elements.confirmDialog._resolver = resolver;
    elements.confirmDialog.showModal();
    window.setTimeout(() => elements.confirmCancel?.focus(), 0);
  });
}

async function deleteRecord(record) {
  const confirmed = await askConfirm(
    'Xóa hóa đơn?',
    `Hóa đơn “${record.merchant || formatDate(record.date)}” sẽ bị xóa khỏi sổ chi cục bộ.`,
    'Xóa hóa đơn',
    'Giữ lại',
  );
  if (!confirmed) {
    const original = [...elements.receiptList.querySelectorAll('.receipt-item')]
      .find((item) => item.dataset.recordId === record.id);
    original?.querySelector('.receipt-delete')?.focus();
    return;
  }
  const recordIndex = state.records.findIndex((item) => item.id === record.id);
  try {
    if (!ledger.delete(record.id)) return;
  } catch (error) {
    const message = error?.code === 'QUOTA_EXCEEDED'
      ? 'Không thể xóa vì dung lượng trình duyệt đã đầy.'
      : error?.message || 'Không thể xóa hóa đơn.';
    showToast(message, 'error');
    return;
  }
  state.records = ledger.list({ sort: 'date-desc' });
  populateMonthFilter();
  render();
  window.setTimeout(() => {
    const editButtons = [...elements.receiptList.querySelectorAll('.receipt-edit')];
    const nextButton = editButtons[Math.min(Math.max(recordIndex, 0), editButtons.length - 1)];
    (nextButton || elements.searchReceipts).focus();
  }, 0);
  showToast('Đã xóa hóa đơn.', 'success');
  announce('Đã xóa hóa đơn.');
}

function backupErrorMessage(error) {
  if (error?.code === 'INVALID_RECEIPTS') {
    return 'Bản sao lưu chứa bản ghi không hợp lệ; không có dữ liệu nào được ghi.';
  }
  if (error?.code === 'DUPLICATE_RECEIPT') {
    return 'Bản sao lưu chứa hóa đơn trùng; không có dữ liệu nào được ghi.';
  }
  if (error?.code === 'UNSUPPORTED_VERSION') {
    return 'Phiên bản bản sao lưu không được hỗ trợ.';
  }
  if (error?.code === 'INVALID_JSON') {
    return 'Tệp sao lưu không phải JSON hợp lệ; không có dữ liệu nào được ghi.';
  }
  if (error?.code === 'INVALID_BACKUP_TYPE') {
    return 'Tệp này không phải bản sao lưu của Tích Lũy; không có dữ liệu nào được ghi.';
  }
  if (error?.code === 'INVALID_BACKUP' || error?.code === 'INVALID_SCHEMA' || error?.code === 'INVALID_SCHEMA_VERSION') {
    return 'Bản sao lưu có cấu trúc không hợp lệ; không có dữ liệu nào được ghi.';
  }
  return 'Không thể nhập sao lưu. Hãy kiểm tra lại tệp JSON.';
}

async function importBackup(file) {
  if (!file) return;
  if (file.size > MAX_BACKUP_BYTES) {
    showToast('Tệp sao lưu quá lớn (giới hạn 8 MB).', 'error');
    return;
  }
  try {
    const records = parseBackup(await file.text());
    const existingIds = new Set(state.records.map((record) => record.id));
    const newRecords = records
      .map((record) => ({
        ...record,
        category: normalizeCategory(record.category),
        paymentMethod: normalizePaymentMethod(record.paymentMethod),
        imageDataUrl: '',
      }))
      .filter((record) => !existingIds.has(record.id));
    const duplicateCount = records.length - newRecords.length;
    if (!newRecords.length) {
      showToast('Các hóa đơn trong tệp đã có trong sổ chi.', 'info');
      return;
    }
    const details = [
      `Tệp: ${file.name}.`,
      `Sẽ thêm ${newRecords.length} hóa đơn.`,
      duplicateCount ? `Bỏ qua ${duplicateCount} bản trùng.` : '',
      'Dữ liệu hiện có không bị thay thế.',
    ].filter(Boolean).join(' ');
    const confirmed = await askConfirm(
      'Nhập bản sao lưu?',
      details,
      'Nhập dữ liệu',
    );
    if (!confirmed) return;
    const result = ledger.importBackup(serializeBackup(newRecords), { mode: 'merge' });
    state.records = ledger.list({ sort: 'date-desc' });
    populateMonthFilter();
    render();
    showToast(`Đã nhập ${result.imported} hóa đơn.`, 'success');
    announce(`Đã nhập ${result.imported} hóa đơn.`);
  } catch (error) {
    const message = backupErrorMessage(error);
    showToast(message, 'error');
    announce(message);
  } finally {
    elements.importJson.value = '';
  }
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function exportCsv() {
  const filtered = getFilteredRecords();
  if (!filtered.length) {
    showToast('Không có hóa đơn để xuất.', 'info');
    return;
  }
  const csvRecords = filtered.map((record) => ({
    ...record,
    paymentMethod: PAYMENT_METHODS[record.paymentMethod] || PAYMENT_METHODS.other,
    category: categoryLabel(record.category),
  }));
  downloadFile(toCSV(csvRecords), `tich-luy-${localDateKey()}.csv`, 'text/csv;charset=utf-8');
  showToast(`Đã xuất ${filtered.length} hóa đơn ra CSV.`, 'success');
}

function exportJson() {
  if (!state.records.length) {
    showToast('Sổ chi đang trống nên chưa có bản sao lưu.', 'info');
    return;
  }
  downloadFile(ledger.exportBackup(), `tich-luy-backup-${localDateKey()}.json`, 'application/json;charset=utf-8');
  showToast('Đã tạo bản sao lưu JSON.', 'success');
}

function validateImage(file) {
  if (!file) return 'Không có tệp nào được chọn.';
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  const extensionOkay = /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!allowed.includes(file.type) && !extensionOkay) return 'Chỉ hỗ trợ ảnh JPG, PNG hoặc WebP.';
  if (file.size > MAX_IMAGE_BYTES) return 'Ảnh vượt quá giới hạn 12 MB.';
  return '';
}

function showPreview(file) {
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = URL.createObjectURL(file);
  elements.receiptPreview.src = state.objectUrl;
  elements.previewName.textContent = file.name;
  elements.dropEmpty.hidden = true;
  elements.dropPreview.hidden = false;
}

async function runOcr(file) {
  const error = validateImage(file);
  if (error) {
    showToast(error, 'error');
    setFormMessage(error, 'error');
    announce(error);
    return;
  }
  const runId = ++state.ocrRunId;

  const shouldMoveFocus = [
    elements.dropZone,
    elements.cameraButton,
    elements.receiptInput,
    elements.cameraInput,
    elements.cancelOcr,
  ].some((element) => element === document.activeElement || element?.contains(document.activeElement));

  showPreview(file);
  state.isOcrBusy = true;
  showProgress(true);
  setFormMessage('Đang đọc hóa đơn cục bộ. Ảnh không được tải lên máy chủ.');

  try {
    const result = await recognizeReceipt(file, ({ progress, status, detail }) => {
      if (runId === state.ocrRunId) setProgress(progress, status, detail);
    });
    if (runId !== state.ocrRunId) return;
    if (!result.text.trim()) throw new Error('Không đọc được chữ trên ảnh. Hãy thử ảnh rõ hơn hoặc dùng hóa đơn mẫu.');
    const parsed = parseReceipt(result.text);
    fillFormFromParsed(parsed, result.text);
    setFormMessage('Đã đọc xong. Hãy kiểm tra các trường trước khi lưu.', 'success');
    showToast('OCR hoàn tất — hãy kiểm tra dữ liệu.', 'success');
    announce('OCR hoàn tất. Dữ liệu đã sẵn sàng để kiểm tra.');
    if (shouldMoveFocus) elements.reviewTitle.focus();
  } catch (ocrError) {
    if (runId !== state.ocrRunId) return;
    if (ocrError?.name === 'AbortError') {
      setFormMessage('Đã hủy OCR. Bạn vẫn có thể nhập dữ liệu thủ công.', 'info');
      showToast('Đã hủy OCR.', 'info');
      announce('Đã hủy OCR.');
      window.setTimeout(() => elements.dropZone.focus(), 0);
    } else {
      const message = ocrError?.message || 'Không thể đọc hóa đơn.';
      setFormMessage(`OCR thất bại: ${message}`, 'error');
      showToast(`OCR thất bại: ${message}`, 'error');
      console.error('OCR thất bại:', ocrError);
    }
  } finally {
    if (runId === state.ocrRunId) {
      state.isOcrBusy = false;
      showProgress(false);
    }
  }
}

function loadDemoReceipt() {
  const demoText = [
    'CÔNG TY TNHH MINH AN',
    'Số 42 Nguyễn Huệ, Quận 1, TP.HCM',
    'Hóa đơn GTGT: 00002318',
    'Ngày: 18/11/2026',
    'Tạm tính: 100.000',
    'Thuế GTGT (8%): 8.000',
    'TỔNG THANH TOÁN: 108.000',
    'Thanh toán: Chuyển khoản',
    'Phương thức: Visa',
  ].join('\n');
  const parsed = parseReceipt(demoText);
  fillFormFromParsed(parsed, demoText);
  elements.receiptDate.value = '2026-11-18';
  elements.total.value = '108000';
  elements.vat.value = '8000';
  elements.merchant.value = 'Công ty TNHH Minh An';
  elements.invoiceNumber.value = '00002318';
  elements.category.value = 'food';
  elements.paymentMethod.value = 'transfer';
  elements.note.value = 'Hóa đơn mẫu';
  state.confidence = 100;
  elements.parseConfidence.hidden = false;
  elements.parseConfidence.textContent = 'Hóa đơn mẫu';
  setFormMessage('Đã nạp hóa đơn mẫu. Bạn có thể sửa và lưu ngay.', 'success');
  byId('review-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function applyTheme(theme) {
  const normalized = theme === 'dark' ? 'dark' : 'light';
  elements.body.dataset.theme = normalized;
  elements.themeToggle.setAttribute('aria-pressed', String(normalized === 'dark'));
  elements.themeToggle.setAttribute('aria-label', normalized === 'dark' ? 'Bật chế độ sáng' : 'Bật chế độ tối');
  elements.themeColor?.setAttribute('content', normalized === 'dark' ? '#0b1f18' : '#12372a');
  try {
    localStorage.setItem(THEME_KEY, normalized);
  } catch {
    // Theme persistence is optional; the app still works without storage.
  }
}

function initializeTheme() {
  let stored = null;
  try {
    stored = localStorage.getItem(THEME_KEY);
  } catch {
    stored = null;
  }
  const preferred = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(stored || preferred);
}

function initializeCategoryFilter() {
  const options = [new Option('Tất cả nhóm chi', '')];
  for (const [key, meta] of Object.entries(CATEGORIES)) {
    options.push(new Option(`${meta.icon} ${meta.label}`, key));
  }
  elements.categoryFilter.replaceChildren(...options);
}

function initializeDialog() {
  elements.confirmAction.addEventListener('click', () => {
    const resolver = elements.confirmDialog._resolver;
    elements.confirmDialog._resolver = null;
    resolver?.resolve(true);
  });
  elements.confirmDialog.addEventListener('close', () => {
    const resolver = elements.confirmDialog._resolver;
    elements.confirmDialog._resolver = null;
    resolver?.resolve(false);
  });
}

function bindEvents() {
  elements.themeToggle.addEventListener('click', () => {
    applyTheme(elements.body.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  elements.installApp.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice?.outcome === 'accepted') elements.installApp.hidden = true;
    deferredInstallPrompt = null;
  });

  elements.dropZone.addEventListener('click', () => elements.receiptInput.click());
  elements.dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      elements.receiptInput.click();
    }
  });
  elements.cameraButton.addEventListener('click', () => elements.cameraInput.click());
  elements.receiptInput.addEventListener('change', () => {
    const file = elements.receiptInput.files?.[0];
    elements.receiptInput.value = '';
    if (file) runOcr(file);
  });
  elements.cameraInput.addEventListener('change', () => {
    const file = elements.cameraInput.files?.[0];
    elements.cameraInput.value = '';
    if (file) runOcr(file);
  });

  for (const eventName of ['dragenter', 'dragover']) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.add('is-dragging');
      if (eventName === 'dragenter') announce('Sẵn sàng nhận ảnh hóa đơn.');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove('is-dragging');
    });
  }
  elements.dropZone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) runOcr(file);
  });

  elements.cancelOcr.addEventListener('click', () => {
    cancelOCR();
    state.ocrRunId += 1;
    state.isOcrBusy = false;
    showProgress(false);
    setFormMessage('Đã hủy OCR. Bạn vẫn có thể nhập dữ liệu thủ công.', 'info');
    showToast('Đã hủy OCR.', 'info');
    announce('Đã hủy OCR.');
    elements.dropZone.focus();
  });
  elements.demoButton.addEventListener('click', loadDemoReceipt);
  elements.receiptForm.addEventListener('submit', saveReceipt);
  elements.searchReceipts.addEventListener('input', render);
  elements.monthFilter.addEventListener('change', render);
  elements.categoryFilter.addEventListener('change', render);
  elements.exportCsv.addEventListener('click', exportCsv);
  elements.exportJson.addEventListener('click', exportJson);
  elements.importTrigger.addEventListener('click', () => elements.importJson.click());
  elements.importJson.addEventListener('change', () => {
    const file = elements.importJson.files?.[0];
    if (file) importBackup(file);
  });
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch (error) {
    console.warn('Không thể đăng ký service worker:', error);
  }
}

function initialize() {
  initializeTheme();
  initializeCategoryFilter();
  initializeDialog();
  bindEvents();
  state.records = ledger.list({ sort: 'date-desc' });
  populateMonthFilter();
  elements.receiptDate.value = localDateKey();
  render();

  const storageStatus = ledger.getStatus();
  if (storageStatus.state === 'recovered') {
    showToast('Dữ liệu sổ chi bị hỏng đã được cách ly; ứng dụng bắt đầu với sổ chi trống.', 'error');
  } else if (storageStatus.state === 'repaired') {
    showToast('Sổ chi cũ đã được nâng cấp tự động sang phiên bản mới.', 'info');
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    elements.installApp.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    elements.installApp.hidden = true;
    showToast('Tích Lũy đã được cài đặt.', 'success');
  });
  window.addEventListener('online', () => showToast('Đã kết nối mạng trở lại.', 'success'));
  window.addEventListener('offline', () => showToast('Bạn đang offline — các tính năng đã tải vẫn hoạt động.', 'info'));
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Promise chưa xử lý:', event.reason);
  });
  window.addEventListener('beforeunload', () => {
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  });

  registerServiceWorker();
}

initialize();
