export const CATEGORIES = Object.freeze({
  food: { label: 'Ăn uống', icon: '🍜', color: '#e58a45' },
  transport: { label: 'Di chuyển', icon: '🚕', color: '#4f7cac' },
  office: { label: 'Văn phòng', icon: '🗂️', color: '#9a6fb0' },
  software: { label: 'Phần mềm', icon: '💾', color: '#4c9f70' },
  utilities: { label: 'Điện nước', icon: '💡', color: '#d4a72c' },
  health: { label: 'Y tế', icon: '🩺', color: '#c75c72' },
  education: { label: 'Giáo dục', icon: '🎓', color: '#6c68b5' },
  entertainment: { label: 'Giải trí', icon: '🎬', color: '#a35ca4' },
  travel: { label: 'Du lịch', icon: '✈️', color: '#3b86a8' },
  services: { label: 'Dịch vụ', icon: '🧾', color: '#3c8f8a' },
  shopping: { label: 'Mua sắm', icon: '🛍️', color: '#b66b45' },
  inventory: { label: 'Hàng tồn', icon: '📦', color: '#b76e79' },
  other: { label: 'Khác', icon: '•', color: '#7d877f' },
});

export const PAYMENT_METHODS = Object.freeze({
  cash: 'Tiền mặt',
  card: 'Thẻ',
  transfer: 'Chuyển khoản',
  other: 'Khác',
});

export function categoryLabel(category) {
  return CATEGORIES[category]?.label || CATEGORIES.other.label;
}

export function categoryIcon(category) {
  return CATEGORIES[category]?.icon || CATEGORIES.other.icon;
}

export function categoryColor(category) {
  return CATEGORIES[category]?.color || CATEGORIES.other.color;
}

const CATEGORY_ALIASES = Object.freeze({
  'ăn uống': 'food',
  food: 'food',
  'di chuyển': 'transport',
  transport: 'transport',
  'văn phòng': 'office',
  office: 'office',
  'phần mềm': 'software',
  software: 'software',
  'điện nước': 'utilities',
  utilities: 'utilities',
  'y tế': 'health',
  health: 'health',
  'giáo dục': 'education',
  education: 'education',
  'giải trí': 'entertainment',
  entertainment: 'entertainment',
  'du lịch': 'travel',
  travel: 'travel',
  'dịch vụ': 'services',
  services: 'services',
  'mua sắm': 'shopping',
  shopping: 'shopping',
  'hàng tồn': 'inventory',
  inventory: 'inventory',
  'khác': 'other',
  other: 'other',
});

const PAYMENT_ALIASES = Object.freeze({
  'tiền mặt': 'cash',
  cash: 'cash',
  'thẻ': 'card',
  'thẻ tín dụng': 'card',
  card: 'card',
  visa: 'card',
  mastercard: 'card',
  'chuyển khoản': 'transfer',
  transfer: 'transfer',
  'chuyển khoản ngân hàng': 'transfer',
  'ví điện tử': 'transfer',
  momo: 'transfer',
  'zalo pay': 'transfer',
  zalopay: 'transfer',
  vnpay: 'transfer',
  paypal: 'transfer',
  'apple pay': 'transfer',
  'google pay': 'transfer',
  'khác': 'other',
  other: 'other',
});

export function normalizeCategory(value) {
  const normalized = String(value ?? '').trim().toLocaleLowerCase('vi');
  return CATEGORY_ALIASES[normalized] || 'other';
}

export function normalizePaymentMethod(value) {
  const normalized = String(value ?? '').trim().toLocaleLowerCase('vi');
  return PAYMENT_ALIASES[normalized] || 'other';
}
