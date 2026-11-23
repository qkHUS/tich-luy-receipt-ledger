import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  categoryLabel,
  normalizeCategory,
  normalizePaymentMethod,
} from '../src/categories.js';

test('normalizes Vietnamese and English receipt categories', () => {
  assert.equal(normalizeCategory('Ăn uống'), 'food');
  assert.equal(normalizeCategory('transport'), 'transport');
  assert.equal(normalizeCategory('Không xác định'), 'other');
});

test('normalizes payment methods and has a safe category fallback', () => {
  assert.equal(normalizePaymentMethod('Chuyển khoản'), 'transfer');
  assert.equal(normalizePaymentMethod('VISA'), 'card');
  assert.equal(normalizePaymentMethod('cash'), 'cash');
  assert.equal(normalizePaymentMethod('MoMo'), 'transfer');
  assert.equal(normalizePaymentMethod('ZaloPay'), 'transfer');
  assert.equal(normalizePaymentMethod('VNPay'), 'transfer');
  assert.equal(categoryLabel('missing'), 'Khác');
});
