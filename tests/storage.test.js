import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKUP_KIND,
  CSV_COLUMNS,
  DuplicateReceiptError,
  ReceiptStorage,
  SCHEMA_VERSION,
  STORAGE_KEY,
  UnsupportedVersionError,
  ValidationError,
  createMemoryStorage,
  exportCSV,
  exportBackup,
  migrateData,
  parseBackup,
  sanitizeReceipt,
  serializeBackup,
  validateReceipt,
} from "../src/storage.js";

function receipt(overrides = {}) {
  return {
    id: "receipt-1",
    merchant: "Chợ Hà Nội",
    date: "2026-11-20",
    total: 125_000,
    vat: 10_000,
    invoiceNumber: "HD-001",
    paymentMethod: "Tiền mặt",
    category: "Ăn uống",
    notes: "Mua hoa quả",
    imageDataUrl: "data:image/png;base64,AAAA",
    createdAt: "2026-11-20T12:00:00.000Z",
    updatedAt: "2026-11-20T12:00:00.000Z",
    ...overrides,
  };
}

function trackingStorage(initial = {}) {
  const base = createMemoryStorage(initial);
  return {
    writes: 0,
    getItem(key) {
      return base.getItem(key);
    },
    setItem(key, value) {
      this.writes += 1;
      base.setItem(key, value);
    },
    removeItem(key) {
      base.removeItem(key);
    },
  };
}

class FailingStorage {
  constructor(error) {
    this.error = error;
    this.attempts = 0;
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem() {
    this.attempts += 1;
    throw this.error;
  }
}

test("validates the current receipt schema", () => {
  const result = validateReceipt(receipt());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("rejects invalid receipt fields", async (t) => {
  const invalidCases = [
    ["missing id", { id: undefined }, "id"],
    ["empty merchant", { merchant: "  " }, "merchant"],
    ["invalid date", { date: "2026-02-30" }, "date"],
    ["non-numeric total", { total: "125000" }, "total"],
    ["negative total", { total: -1 }, "total"],
    ["negative VAT", { vat: -0.01 }, "vat"],
    ["non-string category", { category: 5 }, "category"],
    ["invalid image URL", { imageDataUrl: "remote://example.test/receipt.png" }, "imageDataUrl"],
    ["invalid timestamp", { createdAt: "not-a-date" }, "createdAt"],
  ];

  for (const [name, override, field] of invalidCases) {
    await t.test(name, () => {
      const result = validateReceipt(receipt(override));
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((error) => error.field === field));
    });
  }
});

test("sanitizes legacy aliases, localized text, dates, and amounts", () => {
  const sanitized = sanitizeReceipt({
    id: " legacy-1 ",
    shop: "  Quán   Cà Phê  ",
    date: "20/11/2026",
    amount: "1.234,56",
    tax: "123,45",
    invoiceNo: 123,
    payment: "Thẻ tín dụng",
    notes: "Dòng 1\nDòng 2",
  }, { now: "2026-11-21T08:00:00.000Z" });

  assert.deepEqual(sanitized, {
    id: "legacy-1",
    merchant: "Quán Cà Phê",
    date: "2026-11-20",
    total: 1234.56,
    vat: 123.45,
    invoiceNumber: "123",
    paymentMethod: "Thẻ tín dụng",
    category: "Khác",
    notes: "Dòng 1\nDòng 2",
    imageDataUrl: "",
    createdAt: "2026-11-21T08:00:00.000Z",
    updatedAt: "2026-11-21T08:00:00.000Z",
  });
  assert.equal(validateReceipt(sanitized).valid, true);
});

test("sanitization rejects unsafe values instead of silently repairing them", () => {
  assert.throws(
    () => sanitizeReceipt({ merchant: "Cafe", date: "2026-01-01", total: -10 }),
    (error) => error instanceof ValidationError && error.code === "INVALID_TOTAL",
  );
  assert.throws(
    () => sanitizeReceipt({ merchant: "Cafe", date: "31/02/2026" }),
    (error) => error instanceof ValidationError && error.code === "INVALID_DATE",
  );
});

test("migrates bare arrays and version-zero envelopes without losing legacy data", () => {
  const legacy = {
    shop: "Cửa hàng cũ",
    date: "05/10/2026",
    amount: "250.000",
    tax: "20.000",
    invoiceNo: "OLD-9",
  };

  const fromArray = migrateData([legacy]);
  assert.equal(fromArray.sourceVersion, 0);
  assert.equal(fromArray.version, SCHEMA_VERSION);
  assert.equal(fromArray.receipts.length, 1);
  assert.equal(fromArray.receipts[0].merchant, "Cửa hàng cũ");
  assert.equal(fromArray.receipts[0].date, "2026-10-05");
  assert.equal(fromArray.receipts[0].total, 250_000);
  assert.match(fromArray.receipts[0].id, /^legacy_[0-9a-f]{8}$/);
  assert.equal(fromArray.receipts[0].createdAt, "2026-10-05T00:00:00.000Z");

  const fromEnvelope = migrateData({ version: 0, receipts: [legacy] });
  assert.equal(fromEnvelope.receipts.length, 1);
  assert.equal(fromEnvelope.receipts[0].invoiceNumber, "OLD-9");
});

test("migration quarantines invalid records but preserves valid records", () => {
  const result = migrateData({
    version: 1,
    receipts: [
      receipt({ id: "valid" }),
      receipt({ id: "invalid", total: -5 }),
    ],
  });

  assert.equal(result.receipts.length, 1);
  assert.equal(result.receipts[0].id, "valid");
  assert.equal(result.discarded.length, 1);
  assert.equal(result.discarded[0].index, 1);
  assert.ok(result.discarded[0].errors.some((error) => error.field === "total"));
});

test("rejects future schema versions during migration and backup parsing", () => {
  assert.throws(
    () => migrateData({ version: SCHEMA_VERSION + 1, receipts: [] }),
    (error) => error instanceof UnsupportedVersionError && error.version === SCHEMA_VERSION + 1,
  );
  assert.throws(
    () => parseBackup(JSON.stringify({ version: SCHEMA_VERSION + 1, receipts: [] })),
    (error) => error instanceof UnsupportedVersionError,
  );
});

test("loads and persists a migrated legacy ledger", () => {
  const raw = JSON.stringify({
    version: 0,
    receipts: [{
      shop: "Chợ cũ",
      date: "2026-01-02",
      amount: 1000,
    }],
  });
  const storage = createMemoryStorage({ [STORAGE_KEY]: raw });
  const ledger = new ReceiptStorage({
    storage,
    idFactory: () => "generated-1",
    clock: () => "2026-01-03T00:00:00.000Z",
  });

  assert.equal(ledger.getStatus().state, "repaired");
  assert.equal(ledger.count, 1);
  assert.equal(ledger.getReceipt("generated-1").merchant, "Chợ cũ");
  const persisted = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(persisted.version, SCHEMA_VERSION);
  assert.equal(persisted.receipts[0].id, "generated-1");
});

test("recovers from corrupt JSON without discarding the original bytes", () => {
  const corrupt = '{"version":1,"receipts":[oops}';
  const storage = createMemoryStorage({ [STORAGE_KEY]: corrupt });
  const ledger = new ReceiptStorage({ storage });

  assert.equal(ledger.getStatus().state, "recovered");
  assert.equal(ledger.list().length, 0);
  assert.equal(storage.getItem(`${STORAGE_KEY}.corrupt`), corrupt);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), { version: SCHEMA_VERSION, receipts: [] });
});

test("surfaces write and quota errors without changing the in-memory ledger", () => {
  const quotaError = Object.assign(new Error("Storage quota is full"), { name: "QuotaExceededError" });
  const quotaStorage = new FailingStorage(quotaError);
  const quotaLedger = new ReceiptStorage({ storage: quotaStorage, idFactory: () => "new-id" });

  assert.throws(
    () => quotaLedger.add(receipt({ id: undefined })),
    (error) => error.code === "QUOTA_EXCEEDED" && error.cause === quotaError,
  );
  assert.equal(quotaLedger.count, 0);
  assert.equal(quotaStorage.attempts, 1);

  const writeError = new Error("disk is unavailable");
  const writeStorage = new FailingStorage(writeError);
  const writeLedger = new ReceiptStorage({ storage: writeStorage });
  assert.throws(
    () => writeLedger.add(receipt({ id: "new-id" })),
    (error) => error.code === "WRITE_FAILED" && error.cause === writeError,
  );
  assert.equal(writeLedger.count, 0);
});

test("supports deterministic CRUD and filtered listing", () => {
  const storage = trackingStorage();
  let id = 0;
  const ledger = new ReceiptStorage({
    storage,
    idFactory: () => `receipt-${++id}`,
    clock: () => "2026-11-22T10:00:00.000Z",
  });

  const first = ledger.add({
    merchant: "Quán Cà Phê",
    date: "2026-11-20",
    total: 50_000,
    vat: 4_000,
    invoiceNumber: "A-1",
    paymentMethod: "Tiền mặt",
    category: "Ăn uống",
    notes: "Cà phê sữa",
  });
  assert.equal(first.id, "receipt-1");
  assert.equal(first.createdAt, "2026-11-22T10:00:00.000Z");

  const updated = ledger.update("receipt-1", { merchant: "Quán Trà", total: 55_000 });
  assert.equal(updated.merchant, "Quán Trà");
  assert.equal(updated.total, 55_000);
  assert.equal(updated.createdAt, first.createdAt);
  assert.equal(updated.updatedAt, "2026-11-22T10:00:00.000Z");
  assert.equal(ledger.getReceipt("receipt-1").total, 55_000);

  ledger.add(receipt({
    id: "receipt-2",
    merchant: "Xe công nghệ",
    date: "2026-10-03",
    total: 25_000,
    category: "Di chuyển",
  }));

  assert.equal(ledger.list({ month: "2026-11", category: "Ăn uống" }).length, 1);
  assert.equal(ledger.list({ month: "2026-10" })[0].id, "receipt-2");
  assert.equal(ledger.list({ search: "cà phê" }).length, 1);
  assert.equal(ledger.list({ search: "quán trà" }).length, 1);
  assert.equal(ledger.list({ limit: 1 }).length, 1);
  assert.equal(ledger.list()[0].id, "receipt-1");

  assert.throws(
    () => ledger.add(receipt({ id: "receipt-1" })),
    (error) => error instanceof ValidationError && error.code === "DUPLICATE_ID",
  );
  assert.equal(ledger.delete("receipt-1"), true);
  assert.equal(ledger.delete("receipt-1"), false);
  assert.equal(ledger.count, 1);
});

test("backup import is atomic and rejects duplicates without writing", () => {
  const storage = trackingStorage();
  const ledger = new ReceiptStorage({ storage });
  ledger.add(receipt({ id: "existing" }));
  const writesBeforeImport = storage.writes;

  const duplicateBackup = serializeBackup([receipt({ id: "existing" })], {
    exportedAt: "2026-11-22T00:00:00.000Z",
  });
  assert.throws(
    () => ledger.importBackup(duplicateBackup),
    (error) => error instanceof DuplicateReceiptError && error.duplicateIds.includes("existing"),
  );
  assert.equal(storage.writes, writesBeforeImport);
  assert.equal(ledger.count, 1);

  const invalidBackup = JSON.stringify({
    type: BACKUP_KIND,
    version: SCHEMA_VERSION,
    receipts: [receipt({ id: "good" }), receipt({ id: "bad", total: -1 })],
  });
  assert.throws(
    () => ledger.importBackup(invalidBackup),
    (error) => error.code === "INVALID_RECEIPTS",
  );
  assert.equal(storage.writes, writesBeforeImport);
  assert.equal(ledger.count, 1);
});

test("backup import either commits every record or leaves the ledger unchanged", () => {
  let writes = 0;
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      writes += 1;
      if (writes > 1) {
        throw Object.assign(new Error("quota exceeded"), { name: "QuotaExceededError" });
      }
      values.set(key, value);
    },
  };
  const ledger = new ReceiptStorage({ storage });
  ledger.add(receipt({ id: "existing" }));
  const backup = serializeBackup([
    receipt({ id: "imported-1" }),
    receipt({ id: "imported-2", total: 99_000 }),
  ], { exportedAt: "2026-11-22T00:00:00.000Z" });

  assert.throws(
    () => ledger.importBackup(backup),
    (error) => error.code === "QUOTA_EXCEEDED",
  );
  assert.equal(ledger.count, 1);
  assert.equal(ledger.getReceipt("imported-1"), null);
  assert.equal(JSON.parse(values.get(STORAGE_KEY)).receipts.length, 1);
});

test("successful backup import merges records and replace mode is atomic", () => {
  const storage = trackingStorage();
  const ledger = new ReceiptStorage({ storage });
  ledger.add(receipt({ id: "existing" }));
  const backup = serializeBackup([receipt({ id: "imported" })], {
    exportedAt: "2026-11-22T00:00:00.000Z",
  });

  const result = ledger.importBackup(backup);
  assert.equal(result.imported, 1);
  assert.equal(result.total, 2);
  assert.equal(ledger.count, 2);

  const replacement = ledger.importBackup(
    serializeBackup([receipt({ id: "replacement" })], {
      exportedAt: "2026-11-22T01:00:00.000Z",
    }),
    { mode: "replace" },
  );
  assert.equal(replacement.mode, "replace");
  assert.equal(ledger.count, 1);
  assert.equal(ledger.getReceipt("replacement").id, "replacement");
  assert.equal(ledger.getReceipt("existing"), null);
});

test("detects duplicate IDs inside a backup", () => {
  const duplicateBackup = JSON.stringify({
    type: BACKUP_KIND,
    version: SCHEMA_VERSION,
    receipts: [receipt({ id: "same" }), receipt({ id: "same" })],
  });
  assert.throws(
    () => parseBackup(duplicateBackup),
    (error) => error instanceof DuplicateReceiptError && error.duplicateIds.includes("same"),
  );
});

test("exports CSV with a UTF-8 BOM, quoting, newlines, and Unicode", () => {
  const csv = exportCSV([
    receipt({
      id: "quoted-1",
      merchant: 'Quán "Cà Phê", Hà Nội',
      notes: 'Dòng 1\nDòng "hai", café',
    }),
  ]);

  assert.equal(csv.startsWith("\uFEFF"), true);
  assert.ok(csv.includes(`${CSV_COLUMNS.join(",")}\r\n`));
  assert.ok(csv.includes('"Quán ""Cà Phê"", Hà Nội"'));
  assert.ok(csv.includes('"Dòng 1\nDòng ""hai"", café"'));
  assert.ok(csv.includes("café"));
  assert.ok(csv.includes("Hà Nội"));
  assert.equal(csv.includes("\\u"), false);
  assert.equal(csv.endsWith("\r\n"), true);
});

test("prevents spreadsheet formula injection in every CSV text cell", () => {
  const csv = exportCSV([
    receipt({
      id: "=1+1",
      merchant: "+SUM(A1:A2)",
      invoiceNumber: "-2+3",
      paymentMethod: "@cmd",
      notes: "=HYPERLINK(\"malicious-target\",\"click\")",
    }),
  ]);

  assert.ok(csv.includes("'=1+1"));
  assert.ok(csv.includes("'+SUM(A1:A2)"));
  assert.ok(csv.includes("'-2+3"));
  assert.ok(csv.includes("'@cmd"));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.equal(csv.includes(",=1+1"), false);
  assert.equal(csv.includes(",+SUM"), false);
  assert.equal(csv.includes(",-2+3"), false);
  assert.equal(csv.includes(",@cmd"), false);
});

test("serializes and parses versioned JSON backups", () => {
  const serialized = serializeBackup([receipt()], {
    exportedAt: "2026-11-22T12:00:00.000Z",
  });
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.type, BACKUP_KIND);
  assert.equal(parsed.version, SCHEMA_VERSION);
  assert.equal(parsed.exportedAt, "2026-11-22T12:00:00.000Z");
  assert.equal(parsed.receipts.length, 1);

  const roundTrip = parseBackup(serialized);
  assert.deepEqual(roundTrip, parsed.receipts);
  assert.equal(exportBackup(roundTrip, { exportedAt: "2026-11-22T12:00:00.000Z" }), serialized);
});

test("rejects corrupt backup JSON and reports a stable error code", () => {
  assert.throws(
    () => parseBackup("{not-json"),
    (error) => error.code === "INVALID_JSON",
  );
  assert.throws(
    () => parseBackup(JSON.stringify({ type: "wrong-type", version: 1, receipts: [] })),
    (error) => error.code === "INVALID_BACKUP_TYPE",
  );
});
