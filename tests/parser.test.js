import test from "node:test";
import assert from "node:assert/strict";

import {
  categorizeReceipt,
  extractCategory,
  extractDate,
  extractInvoiceNumber,
  extractMerchant,
  extractPaymentMethod,
  extractTotal,
  extractVat,
  normalizeLines,
  parseAmount,
  parseReceipt,
} from "../src/parser.js";

test("normalizeLines normalizes line endings and collapses whitespace", () => {
  assert.deepEqual(normalizeLines("  Cà phê   An  \r\n\u00a0Số 12\r"), [
    "Cà phê An",
    "Số 12",
  ]);
  assert.deepEqual(normalizeLines(["  Một  ", "", "Hai"]), ["Một", "Hai"]);
  assert.deepEqual(normalizeLines(null), []);
});

test("parseAmount handles Vietnamese and English number conventions", () => {
  assert.equal(parseAmount("1.234.567"), 1_234_567);
  assert.equal(parseAmount("1,234,567"), 1_234_567);
  assert.equal(parseAmount("12.500"), 12_500);
  assert.equal(parseAmount("12,500"), 12_500);
  assert.equal(parseAmount("12,50"), 12.5);
  assert.equal(parseAmount("12.50"), 12.5);
  assert.equal(parseAmount("1,234.56"), 1_234.56);
  assert.equal(parseAmount("1.234,56"), 1_234.56);
  assert.equal(parseAmount("12 500"), 12_500);
  assert.equal(parseAmount("125.000đ"), 125_000);
  assert.equal(parseAmount("$1,234.56"), 1_234.56);
});

test("parseAmount repairs common OCR O/D zero confusions", () => {
  assert.equal(parseAmount("1O.OOO"), 10_000);
  assert.equal(parseAmount("2D.000"), 20_000);
  assert.equal(parseAmount("12,5OO"), 12_500);
  assert.equal(parseAmount("O"), 0);
  assert.equal(parseAmount("not an amount"), null);
  assert.equal(parseAmount(""), null);
});

test("parseReceipt extracts a complete Vietnamese receipt", () => {
  const text = `
CỬA HÀNG MINH AN
Địa chỉ: 12 Nguyễn Huệ, Quận 1
MST: 0101234567
Số hóa đơn: HD-2024-000123
Ngày: 05/04/2024
Cà phê đen x2                 90.000
Tạm tính:                    900.000
GTGT (10%):                    90.000
TỔNG CỘNG:                   990.000
Thanh toán: Tiền mặt
`;

  const receipt = parseReceipt(text);
  assert.equal(receipt.merchant, "MINH AN");
  assert.equal(receipt.date, "2024-04-05");
  assert.equal(receipt.total, 990_000);
  assert.equal(receipt.vat, 90_000);
  assert.equal(receipt.invoiceNumber, "HD-2024-000123");
  assert.equal(receipt.paymentMethod, "Tiền mặt");
  assert.equal(receipt.category, "food");
  assert.equal(receipt.rawText, text);
  assert.ok(receipt.lines.includes("TỔNG CỘNG: 990.000"));
  assert.ok(receipt.confidence.total > 0.95);
  assert.ok(receipt.confidence.date > 0.95);
  assert.ok(receipt.confidence.vat > 0.9);
});

test("parseReceipt extracts a complete English receipt", () => {
  const text = `
GREEN LEAF CAFE
88 Market Street
Invoice No. INV-2024-0042
Date: 2024-04-08
Latte                         20.00
Subtotal:                     20.00
VAT:                           1.60
TOTAL: $21.60
Payment Method: Credit Card
`;

  const receipt = parseReceipt(text);
  assert.equal(receipt.merchant, "GREEN LEAF CAFE");
  assert.equal(receipt.date, "2024-04-08");
  assert.equal(receipt.total, 21.6);
  assert.equal(receipt.vat, 1.6);
  assert.equal(receipt.invoiceNumber, "INV-2024-0042");
  assert.equal(receipt.paymentMethod, "Credit Card");
  assert.equal(receipt.category, "food");
});

test("total extraction strongly prefers explicit totals over subtotals", () => {
  const text = `
Cửa hàng Mẫu
Tạm tính: 1.000.000
TAM TINH: 1.000.000
Subtotal: 1,000,000.00
TỔNG: 1.100.000
TOTAL: 1.100,000.00
`;

  assert.equal(extractTotal(text), 1_100_000);
  assert.equal(parseReceipt(text).total, 1_100_000);
});

test("total extraction chooses a final payment total and ignores quantities", () => {
  const text = `
Tổng số lượng: 3
Tổng tiền hàng: 900.000
TỔNG CỘNG: 900.000
THANH TOÁN: 990.000
`;

  assert.equal(extractTotal(text), 990_000);
  assert.equal(
    extractTotal("TONG TIEN HANG: 100.000\nTONG: 110.000"),
    110_000,
  );
});

test("total fallback never treats invoice identifiers as money", () => {
  assert.equal(extractTotal("Số hóa đơn: 00002318"), null);
  assert.equal(extractTotal("Invoice No. 2318"), null);
  assert.equal(extractTotal("Mã đơn hàng: 8472"), null);
  assert.equal(
    extractTotal("Phụ kiện: 2\nTỔNG THANH TOÁN: 350.000"),
    350_000,
  );
});

test("VAT extraction accepts Vietnamese and English labels", () => {
  assert.equal(extractVat("GTGT (10%): 1.000"), 1_000);
  assert.equal(extractVat("VAT 8% 80.000"), 80_000);
  assert.equal(extractVat("Sales Tax: $1.60"), 1.6);
  assert.equal(extractVat("GIÁ TRỊ GIA TĂNG: 1.000"), 1_000);
  assert.equal(extractVat("Hóa đơn GTGT: 00002318"), null);
  assert.equal(extractVat("VAT: 10%"), null);
  assert.equal(extractVat("Tax code: 0101234567"), null);
});

test("date extraction prioritizes DD/MM/YYYY and rejects impossible dates", () => {
  assert.equal(extractDate("Ngày: 03/04/2024"), "2024-04-03");
  assert.equal(extractDate("Date: 03/04/24"), "2024-04-03");
  assert.equal(extractDate("Ngày: 31/02/2024"), null);
  assert.equal(extractDate("Ngày: 29/02/2023"), null);
  assert.equal(extractDate("Ngày: 29/02/2024"), "2024-02-29");
  assert.equal(extractDate("Ngày: 31/02/2024\nNgày: 15/03/2024"), "2024-03-15");
  assert.equal(extractDate("Date: 2024-04-08"), "2024-04-08");
  assert.equal(extractDate("Date: Apr 3, 2024"), "2024-04-03");
  assert.equal(extractDate("Date: 04/13/2024"), "2024-04-13");
  assert.equal(extractDate("Expiry: 31/12/2024"), null);
});

test("invoice number extraction preserves leading zeroes and identifiers", () => {
  assert.equal(extractInvoiceNumber("Số hóa đơn: 00000123"), "00000123");
  assert.equal(extractInvoiceNumber("Số hoá đơn: HD-0009"), "HD-0009");
  assert.equal(extractInvoiceNumber("Hóa đơn số: 2024/001"), "2024/001");
  assert.equal(extractInvoiceNumber("Mã số hóa đơn: MS-2024-09"), "MS-2024-09");
  assert.equal(extractInvoiceNumber("Hóa đơn GTGT: 00002318"), "00002318");
  assert.equal(extractInvoiceNumber("Invoice #: INV-2024-0042"), "INV-2024-0042");
  assert.equal(extractInvoiceNumber("Invoice: inv-2024-0042"), "inv-2024-0042");
  assert.equal(extractInvoiceNumber("Receipt No. 55"), "55");
  assert.equal(extractInvoiceNumber("HÓA ĐƠN"), null);
});

test("payment method extraction recognizes common Vietnamese and English forms", () => {
  assert.equal(extractPaymentMethod("Phương thức thanh toán: Tiền mặt"), "Tiền mặt");
  assert.equal(extractPaymentMethod("Thanh toán: Chuyển khoản"), "Chuyển khoản");
  assert.equal(extractPaymentMethod("Payment Method: Credit Card"), "Credit Card");
  assert.equal(extractPaymentMethod("Payment: Visa"), "Visa");
  assert.equal(extractPaymentMethod("Paid by MoMo"), "MoMo");
  assert.equal(extractPaymentMethod("Cash"), "Cash");
  assert.equal(extractPaymentMethod("THANH TOÁN: 990.000"), null);
});

test("category heuristics cover common expense types", () => {
  assert.equal(extractCategory("Highlands Coffee"), "food");
  assert.equal(extractCategory("GrabTrip"), "transport");
  assert.equal(extractCategory("FPT Telecom"), "utilities");
  assert.equal(extractCategory("Guardian Pharmacy"), "health");
  assert.equal(extractCategory("VinMart"), "shopping");
  assert.equal(extractCategory("An unfamiliar merchant"), "other");
  assert.equal(categorizeReceipt("STARBUCKS COFFEE"), "food");
});

test("merchant extraction prefers explicit labels and skips receipt metadata", () => {
  assert.equal(extractMerchant("Cửa hàng: Chợ An Phú\nĐịa chỉ: 1 Hà Nội"), "Chợ An Phú");
  assert.equal(extractMerchant("Store: Corner Shop\nMST: 123"), "Corner Shop");
  assert.equal(
    extractMerchant("BIÊN NHẬN\nTIGER COFFEE\nĐịa chỉ: 5 Lê Lợi"),
    "TIGER COFFEE",
  );
  assert.equal(extractMerchant("Ngày: 01/01/2024\nMST: 123"), null);
});

test("missing fields are represented explicitly and confidence is bounded", () => {
  const receipt = parseReceipt("");
  assert.deepEqual(Object.keys(receipt), [
    "merchant",
    "date",
    "total",
    "vat",
    "invoiceNumber",
    "paymentMethod",
    "category",
    "confidence",
    "lines",
    "rawText",
  ]);
  assert.equal(receipt.merchant, null);
  assert.equal(receipt.date, null);
  assert.equal(receipt.total, null);
  assert.equal(receipt.vat, null);
  assert.equal(receipt.invoiceNumber, null);
  assert.equal(receipt.paymentMethod, null);
  assert.equal(receipt.category, "other");
  assert.deepEqual(receipt.lines, []);
  assert.equal(receipt.rawText, "");

  for (const confidence of Object.values(receipt.confidence)) {
    assert.ok(confidence >= 0 && confidence <= 1);
  }
  assert.equal(receipt.confidence.merchant, 0);
  assert.equal(receipt.confidence.total, 0);
});
