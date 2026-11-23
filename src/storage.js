const STORAGE_VERSION = 1;

export const SCHEMA_VERSION = STORAGE_VERSION;
export const CURRENT_SCHEMA_VERSION = STORAGE_VERSION;
export const LEDGER_SCHEMA_VERSION = STORAGE_VERSION;
export const STORAGE_KEY = "tich-luy.receipts";
export const RECEIPTS_STORAGE_KEY = STORAGE_KEY;
export const BACKUP_KIND = "tich-luy-receipt-ledger-backup";

export const CSV_COLUMNS = Object.freeze([
  "id",
  "date",
  "merchant",
  "total",
  "vat",
  "invoiceNumber",
  "paymentMethod",
  "category",
  "notes",
  "createdAt",
  "updatedAt",
]);

const DEFAULT_CATEGORY = "Khác";
const MAX_ID_LENGTH = 128;
const MAX_MERCHANT_LENGTH = 240;
const MAX_INVOICE_LENGTH = 120;
const MAX_PAYMENT_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 100;
const MAX_NOTES_LENGTH = 4000;
const MAX_IMAGE_LENGTH = 5_000_000;
const UTF8_BOM = "\uFEFF";

const RECEIPT_ALIASES = Object.freeze({
  id: ["id", "receiptId"],
  merchant: ["merchant", "merchantName", "shop", "store", "seller", "vendor"],
  date: ["date", "receiptDate", "transactionDate", "createdDate"],
  total: ["total", "totalAmount", "grandTotal", "amount"],
  vat: ["vat", "vatAmount", "tax", "taxAmount"],
  invoiceNumber: ["invoiceNumber", "invoiceNo", "invoice", "invoiceCode"],
  paymentMethod: ["paymentMethod", "payment", "paymentType", "paymentMethodName"],
  category: ["category", "expenseCategory", "group"],
  notes: ["notes", "note", "description"],
  imageDataUrl: ["imageDataUrl", "image", "imageUrl", "receiptImage"],
  createdAt: ["createdAt", "created_at", "timestamp"],
  updatedAt: ["updatedAt", "updated_at", "modifiedAt"],
});

export class ValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = "ValidationError";
    this.code = errors[0]?.code ?? "INVALID_RECEIPT";
    this.errors = errors;
    this.details = errors;
  }
}

export class BackupError extends Error {
  constructor(message, code = "INVALID_BACKUP", details = []) {
    super(message);
    this.name = "BackupError";
    this.code = code;
    this.details = details;
  }
}

export class DuplicateReceiptError extends BackupError {
  constructor(duplicateIds = [], message = "Backup contains duplicate receipt IDs") {
    super(message, "DUPLICATE_RECEIPT", duplicateIds.map((id) => ({ id })));
    this.name = "DuplicateReceiptError";
    this.duplicateIds = [...duplicateIds];
  }
}

export class UnsupportedVersionError extends BackupError {
  constructor(version, supportedVersion = SCHEMA_VERSION) {
    super(
      `Unsupported schema version ${version}; the supported version is ${supportedVersion}`,
      "UNSUPPORTED_VERSION",
      [{ version, supportedVersion }],
    );
    this.name = "UnsupportedVersionError";
    this.version = version;
    this.supportedVersion = supportedVersion;
  }
}

export class StorageError extends Error {
  constructor(message, code = "STORAGE_ERROR", cause = undefined, details = []) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.cause = cause;
    this.details = details;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function firstDefined(object, names) {
  for (const name of names) {
    if (hasOwn(object, name) && object[name] !== undefined && object[name] !== null) {
      return object[name];
    }
  }
  return undefined;
}

function mapLegacyFields(record) {
  const mapped = {};
  for (const [canonical, aliases] of Object.entries(RECEIPT_ALIASES)) {
    const value = firstDefined(record, aliases);
    if (value !== undefined) {
      mapped[canonical] = value;
    }
  }
  return mapped;
}

function removeControlCharacters(value, preserveNewlines = false) {
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    const isAllowedNewline =
      preserveNewlines && (character === "\n" || character === "\r" || character === "\t");
    if (isAllowedNewline) {
      result += character;
      continue;
    }
    if (codePoint < 0x20 || codePoint === 0x7f) {
      continue;
    }
    result += character;
  }
  return result;
}

function cleanText(value, { preserveNewlines = false } = {}) {
  let text = String(value).replace(/\u0000/g, "");
  if (preserveNewlines) {
    text = removeControlCharacters(text, true).replace(/\r\n?/g, "\n").trim();
    return text;
  }
  text = removeControlCharacters(text, false).replace(/\s+/g, " ").trim();
  return text;
}

function normalizeIdentifier(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }
  const identifier = removeControlCharacters(String(value)).trim();
  if (!identifier || identifier.length > MAX_ID_LENGTH) {
    return "";
  }
  return identifier;
}

function isValidYearMonthDay(year, month, day) {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

function yearMonthDayFromParts(year, month, day) {
  if (!isValidYearMonthDay(year, month, day)) {
    return "";
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeDate(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      return "";
    }
    return yearMonthDayFromParts(
      value.getUTCFullYear(),
      value.getUTCMonth() + 1,
      value.getUTCDate(),
    );
  }
  if (typeof value === "number") {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return "";
    }
    return yearMonthDayFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  if (typeof value !== "string") {
    return "";
  }

  const text = value.trim().replace(/^\uFEFF/, "");
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(text);
  if (match) {
    return yearMonthDayFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(text);
  if (match) {
    return yearMonthDayFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (first > 12 && second <= 12) {
      return yearMonthDayFromParts(Number(match[3]), second, first);
    }
    return yearMonthDayFromParts(Number(match[3]), second, first);
  }

  return "";
}

function normalizeAmount(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000_000) {
      return null;
    }
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
  if (typeof value !== "string") {
    return null;
  }

  let text = value.trim().replace(/[₫đvnd\s]/gi, "");
  if (!text || !/^\d[\d.,]*$/.test(text)) {
    return null;
  }

  const dotIndex = text.lastIndexOf(".");
  const commaIndex = text.lastIndexOf(",");
  if (dotIndex !== -1 && commaIndex !== -1) {
    const decimalIndex = Math.max(dotIndex, commaIndex);
    const integerPart = text.slice(0, decimalIndex).replace(/[.,]/g, "");
    const fractionPart = text.slice(decimalIndex + 1).replace(/[.,]/g, "");
    text = `${integerPart}.${fractionPart}`;
  } else if (commaIndex !== -1) {
    if (text.indexOf(",") !== commaIndex) {
      const lastComma = commaIndex;
      const integerPart = text.slice(0, lastComma).replace(/,/g, "");
      const fractionPart = text.slice(lastComma + 1).replace(/,/g, "");
      text = `${integerPart}.${fractionPart}`;
    } else if (/^\d{1,3}(?:,\d{3})+$/.test(text)) {
      text = text.replace(/,/g, "");
    } else {
      text = text.replace(",", ".");
    }
  } else if (dotIndex !== -1) {
    if (text.indexOf(".") !== dotIndex) {
      const lastDot = dotIndex;
      const integerPart = text.slice(0, lastDot).replace(/\./g, "");
      const fractionPart = text.slice(lastDot + 1).replace(/\./g, "");
      text = `${integerPart}.${fractionPart}`;
    } else if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) {
      text = text.replace(/\./g, "");
    } else {
      text = text.replace(".", ".");
    }
  }

  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000) {
    return null;
  }
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function normalizeTimestamp(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
  }
  if (typeof value !== "string") {
    return "";
  }
  const text = value.trim();
  if (!text) {
    return "";
  }
  if (/^\d{10,13}$/.test(text)) {
    const numeric = Number(text);
    const date = new Date(text.length === 10 ? numeric * 1000 : numeric);
    return Number.isFinite(date.getTime()) ? date.toISOString() : "";
  }
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function resolveNow(nowOption) {
  const raw = typeof nowOption === "function" ? nowOption() : nowOption;
  const value = raw instanceof Date ? raw.toISOString() : raw;
  return normalizeTimestamp(value ?? new Date());
}

function resolveGeneratedId(idFactory) {
  const raw = typeof idFactory === "function" ? idFactory() : idFactory;
  return normalizeIdentifier(raw);
}

function defaultIdFactory() {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return `receipt_${randomUuid}`;
  }
  return `receipt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isImageDataUrl(value) {
  if (value === "") {
    return true;
  }
  if (typeof value !== "string" || value.length > MAX_IMAGE_LENGTH) {
    return false;
  }
  return /^data:image\/(?:png|jpe?g|webp);base64,[a-zA-Z0-9+/=\s]*$/.test(value);
}

function validationError(field, code, message, value) {
  return { field, code, message, value };
}

export function validateReceipt(receipt) {
  const errors = [];
  if (!isPlainObject(receipt)) {
    errors.push(validationError("record", "INVALID_TYPE", "Receipt must be a plain object", receipt));
    return { valid: false, errors };
  }

  if (typeof receipt.id !== "string" || !normalizeIdentifier(receipt.id)) {
    errors.push(validationError("id", "INVALID_ID", "Receipt id must be a non-empty string", receipt.id));
  } else if (receipt.id.trim().length > MAX_ID_LENGTH) {
    errors.push(validationError("id", "INVALID_ID", `Receipt id must not exceed ${MAX_ID_LENGTH} characters`, receipt.id));
  }

  if (typeof receipt.merchant !== "string" || !cleanText(receipt.merchant)) {
    errors.push(validationError("merchant", "INVALID_MERCHANT", "Merchant must be a non-empty string", receipt.merchant));
  } else if (cleanText(receipt.merchant).length > MAX_MERCHANT_LENGTH) {
    errors.push(validationError("merchant", "INVALID_MERCHANT", `Merchant must not exceed ${MAX_MERCHANT_LENGTH} characters`, receipt.merchant));
  }

  if (typeof receipt.date !== "string" || normalizeDate(receipt.date) !== receipt.date) {
    errors.push(validationError("date", "INVALID_DATE", "Date must be a valid YYYY-MM-DD date", receipt.date));
  }

  if (typeof receipt.total !== "number" || !Number.isFinite(receipt.total) || receipt.total < 0) {
    errors.push(validationError("total", "INVALID_TOTAL", "Total must be a finite non-negative number", receipt.total));
  }

  if (receipt.vat !== undefined) {
    if (typeof receipt.vat !== "number" || !Number.isFinite(receipt.vat) || receipt.vat < 0) {
      errors.push(validationError("vat", "INVALID_VAT", "VAT must be a finite non-negative number", receipt.vat));
    }
  }

  for (const [field, maxLength] of [
    ["invoiceNumber", MAX_INVOICE_LENGTH],
    ["paymentMethod", MAX_PAYMENT_LENGTH],
    ["category", MAX_CATEGORY_LENGTH],
  ]) {
    if (receipt[field] !== undefined && typeof receipt[field] !== "string") {
      errors.push(validationError(field, "INVALID_TEXT", `${field} must be a string`, receipt[field]));
    } else if (typeof receipt[field] === "string" && receipt[field].length > maxLength) {
      errors.push(validationError(field, "INVALID_TEXT", `${field} must not exceed ${maxLength} characters`, receipt[field]));
    }
  }

  if (receipt.notes !== undefined) {
    if (typeof receipt.notes !== "string") {
      errors.push(validationError("notes", "INVALID_TEXT", "Notes must be a string", receipt.notes));
    } else if (receipt.notes.length > MAX_NOTES_LENGTH) {
      errors.push(validationError("notes", "INVALID_TEXT", `Notes must not exceed ${MAX_NOTES_LENGTH} characters`, receipt.notes));
    }
  }

  if (receipt.imageDataUrl !== undefined && !isImageDataUrl(receipt.imageDataUrl)) {
    errors.push(validationError("imageDataUrl", "INVALID_IMAGE", "Image must be a local image data URL", receipt.imageDataUrl));
  }

  for (const field of ["createdAt", "updatedAt"]) {
    if (receipt[field] !== undefined) {
      if (typeof receipt[field] !== "string" || !normalizeTimestamp(receipt[field])) {
        errors.push(validationError(field, "INVALID_TIMESTAMP", `${field} must be a valid timestamp`, receipt[field]));
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function isValidReceipt(receipt) {
  return validateReceipt(receipt).valid;
}

export function sanitizeReceipt(receipt, options = {}) {
  if (!isPlainObject(receipt)) {
    throw new ValidationError("Receipt must be a plain object", [
      validationError("record", "INVALID_TYPE", "Receipt must be a plain object", receipt),
    ]);
  }

  const canonical = mapLegacyFields(receipt);
  if (!normalizeIdentifier(canonical.id)) {
    const idFactory = options.idFactory ?? defaultIdFactory;
    const generatedId = resolveGeneratedId(idFactory);
    if (!generatedId) {
      throw new ValidationError("A valid receipt id could not be generated", [
        validationError("id", "INVALID_ID", "Receipt id must be a non-empty string", canonical.id),
      ]);
    }
    canonical.id = generatedId;
  }

  const needsGeneratedTime =
    canonical.createdAt === undefined || canonical.createdAt === null || canonical.createdAt === "";
  const now = needsGeneratedTime ? resolveNow(options.now) : "";
  const merchant = cleanText(canonical.merchant ?? "");
  const date = normalizeDate(canonical.date);
  const total = normalizeAmount(canonical.total);
  const vat = canonical.vat === undefined || canonical.vat === null ? 0 : normalizeAmount(canonical.vat);
  const invoiceNumber = cleanText(canonical.invoiceNumber ?? "");
  const paymentMethod = cleanText(canonical.paymentMethod ?? "");
  const category = cleanText(canonical.category ?? "") || DEFAULT_CATEGORY;
  const notes = cleanText(canonical.notes ?? "", { preserveNewlines: true });
  const imageDataUrl = canonical.imageDataUrl === undefined || canonical.imageDataUrl === null
    ? ""
    : String(canonical.imageDataUrl).trim();
  const createdAt = canonical.createdAt === undefined || canonical.createdAt === null || canonical.createdAt === ""
    ? now
    : normalizeTimestamp(canonical.createdAt);
  const updatedAt = canonical.updatedAt === undefined || canonical.updatedAt === null || canonical.updatedAt === ""
    ? createdAt
    : normalizeTimestamp(canonical.updatedAt);

  const sanitized = {
    id: normalizeIdentifier(canonical.id),
    merchant,
    date,
    total: total ?? Number.NaN,
    vat: vat ?? Number.NaN,
    invoiceNumber,
    paymentMethod,
    category,
    notes,
    imageDataUrl,
    createdAt,
    updatedAt,
  };

  const errors = [];
  if (!sanitized.id) {
    errors.push(validationError("id", "INVALID_ID", "Receipt id must be a non-empty string", canonical.id));
  }
  if (!sanitized.merchant) {
    errors.push(validationError("merchant", "INVALID_MERCHANT", "Merchant must be a non-empty string", canonical.merchant));
  } else if (sanitized.merchant.length > MAX_MERCHANT_LENGTH) {
    errors.push(validationError("merchant", "INVALID_MERCHANT", `Merchant must not exceed ${MAX_MERCHANT_LENGTH} characters`, canonical.merchant));
  }
  if (!sanitized.date) {
    errors.push(validationError("date", "INVALID_DATE", "Date must be a valid date", canonical.date));
  }
  if (total === null) {
    errors.push(validationError("total", "INVALID_TOTAL", "Total must be a finite non-negative number", canonical.total));
  }
  if (vat === null) {
    errors.push(validationError("vat", "INVALID_VAT", "VAT must be a finite non-negative number", canonical.vat));
  }
  if (sanitized.invoiceNumber.length > MAX_INVOICE_LENGTH) {
    errors.push(validationError("invoiceNumber", "INVALID_TEXT", `Invoice number must not exceed ${MAX_INVOICE_LENGTH} characters`, canonical.invoiceNumber));
  }
  if (sanitized.paymentMethod.length > MAX_PAYMENT_LENGTH) {
    errors.push(validationError("paymentMethod", "INVALID_TEXT", `Payment method must not exceed ${MAX_PAYMENT_LENGTH} characters`, canonical.paymentMethod));
  }
  if (sanitized.category.length > MAX_CATEGORY_LENGTH) {
    errors.push(validationError("category", "INVALID_TEXT", `Category must not exceed ${MAX_CATEGORY_LENGTH} characters`, canonical.category));
  }
  if (sanitized.notes.length > MAX_NOTES_LENGTH) {
    errors.push(validationError("notes", "INVALID_TEXT", `Notes must not exceed ${MAX_NOTES_LENGTH} characters`, canonical.notes));
  }
  if (!isImageDataUrl(sanitized.imageDataUrl)) {
    errors.push(validationError("imageDataUrl", "INVALID_IMAGE", "Image must be a local image data URL", canonical.imageDataUrl));
  }
  if (!sanitized.createdAt) {
    errors.push(validationError("createdAt", "INVALID_TIMESTAMP", "createdAt must be a valid timestamp", canonical.createdAt));
  }
  if (!sanitized.updatedAt) {
    errors.push(validationError("updatedAt", "INVALID_TIMESTAMP", "updatedAt must be a valid timestamp", canonical.updatedAt));
  }

  if (errors.length > 0) {
    throw new ValidationError("Receipt failed validation", errors);
  }
  return sanitized;
}

function legacyIdFor(record) {
  const canonical = mapLegacyFields(record);
  const seed = [
    canonical.merchant ?? "",
    canonical.date ?? "",
    canonical.total ?? "",
    canonical.invoiceNumber ?? "",
  ].join("\u001f");
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `legacy_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function migrateReceipt(receipt, options = {}) {
  if (!isPlainObject(receipt)) {
    throw new ValidationError("Receipt must be a plain object", [
      validationError("record", "INVALID_TYPE", "Receipt must be a plain object", receipt),
    ]);
  }

  const mapped = mapLegacyFields(receipt);
  if (!normalizeIdentifier(mapped.id)) {
    if (options.idFactory) {
      const generated = resolveGeneratedId(options.idFactory);
      if (!generated) {
        throw new ValidationError("A valid receipt id could not be generated", [
          validationError("id", "INVALID_ID", "Receipt id must be a non-empty string", mapped.id),
        ]);
      }
      mapped.id = generated;
    } else {
      mapped.id = legacyIdFor(receipt);
    }
  }

  if ((mapped.createdAt === undefined || mapped.createdAt === null || mapped.createdAt === "") && options.now === undefined) {
    const date = normalizeDate(mapped.date);
    if (date) {
      mapped.createdAt = `${date}T00:00:00.000Z`;
      mapped.updatedAt = mapped.updatedAt ?? mapped.createdAt;
    }
  }

  return sanitizeReceipt(mapped, options);
}

function readEnvelopeVersion(data) {
  if (Array.isArray(data)) {
    return 0;
  }
  if (!isPlainObject(data)) {
    throw new BackupError("Ledger data must be an object or an array", "INVALID_SCHEMA");
  }

  const versions = [data.version, data.schemaVersion, data.schema_version].filter(
    (value) => value !== undefined && value !== null,
  );
  if (versions.length === 0) {
    return 0;
  }
  const normalizedVersions = versions.map((value) => {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
      return Number(value.trim());
    }
    return Number.NaN;
  });
  if (normalizedVersions.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new BackupError("Ledger schema version is invalid", "INVALID_SCHEMA_VERSION");
  }
  if (new Set(normalizedVersions).size > 1) {
    throw new BackupError("Ledger schema version fields disagree", "INVALID_SCHEMA_VERSION");
  }
  const version = normalizedVersions[0];
  if (version > SCHEMA_VERSION) {
    throw new UnsupportedVersionError(version);
  }
  return version;
}

function extractLedgerRecords(data, version) {
  if (Array.isArray(data)) {
    return data;
  }
  if (!isPlainObject(data)) {
    throw new BackupError("Ledger data must be an object or an array", "INVALID_SCHEMA");
  }

  for (const key of ["receipts", "records", "items"]) {
    if (hasOwn(data, key)) {
      if (!Array.isArray(data[key])) {
        throw new BackupError(`Ledger field ${key} must be an array`, "INVALID_SCHEMA");
      }
      return data[key];
    }
  }

  if (hasOwn(data, "data")) {
    if (Array.isArray(data.data)) {
      return data.data;
    }
    if (isPlainObject(data.data)) {
      const nestedVersion = readEnvelopeVersion(data.data);
      return extractLedgerRecords(data.data, nestedVersion);
    }
    throw new BackupError("Ledger field data must be an array or object", "INVALID_SCHEMA");
  }

  if (
    version === 0 &&
    (hasOwn(data, "merchant") || hasOwn(data, "shop") || hasOwn(data, "amount") || hasOwn(data, "total"))
  ) {
    return [data];
  }

  throw new BackupError("Ledger does not contain a receipts array", "INVALID_SCHEMA");
}

export function migrateData(data, options = {}) {
  const sourceVersion = readEnvelopeVersion(data);
  const records = extractLedgerRecords(data, sourceVersion);
  const receipts = [];
  const discarded = [];
  const seenIds = new Set();

  records.forEach((record, index) => {
    try {
      const migrated = migrateReceipt(record, options);
      if (seenIds.has(migrated.id)) {
        discarded.push({
          index,
          errors: [validationError("id", "DUPLICATE_ID", `Duplicate receipt id ${migrated.id}`, migrated.id)],
        });
        return;
      }
      seenIds.add(migrated.id);
      receipts.push(migrated);
    } catch (error) {
      const errors = error instanceof ValidationError
        ? error.errors
        : [validationError("record", "INVALID_RECORD", error.message, record)];
      discarded.push({ index, errors });
    }
  });

  return {
    version: SCHEMA_VERSION,
    sourceVersion,
    receipts,
    discarded,
  };
}

export const migrateLedger = migrateData;

function stripBom(text) {
  return typeof text === "string" && text.startsWith(UTF8_BOM) ? text.slice(1) : text;
}

export function parseBackup(serialized, options = {}) {
  if (typeof serialized !== "string") {
    throw new BackupError("Backup must be a JSON string", "INVALID_JSON");
  }

  let parsed;
  try {
    parsed = JSON.parse(stripBom(serialized));
  } catch (error) {
    throw new BackupError("Backup is not valid JSON", "INVALID_JSON", [
      { message: error.message },
    ]);
  }

  if (isPlainObject(parsed) && parsed.type !== undefined && parsed.type !== BACKUP_KIND) {
    throw new BackupError("Backup has an unknown type", "INVALID_BACKUP_TYPE", [
      { type: parsed.type, expected: BACKUP_KIND },
    ]);
  }

  let migrated;
  try {
    migrated = migrateData(parsed, options);
  } catch (error) {
    if (error instanceof UnsupportedVersionError || error instanceof BackupError) {
      throw error;
    }
    throw new BackupError("Backup has an invalid structure", "INVALID_BACKUP", [
      { message: error.message },
    ]);
  }

  const duplicateIds = migrated.discarded
    .filter((entry) => entry.errors.some((error) => error.code === "DUPLICATE_ID"))
    .map((entry) => entry.errors.find((error) => error.code === "DUPLICATE_ID")?.value)
    .filter((id) => id !== undefined);
  if (duplicateIds.length > 0) {
    throw new DuplicateReceiptError(duplicateIds);
  }
  if (migrated.discarded.length > 0) {
    throw new BackupError("Backup contains invalid receipt records", "INVALID_RECEIPTS", migrated.discarded);
  }

  return migrated.receipts;
}

export const deserializeBackup = parseBackup;

export function serializeBackup(receipts, options = {}) {
  if (!Array.isArray(receipts)) {
    throw new BackupError("Receipts must be an array", "INVALID_RECEIPTS");
  }

  const validated = receipts.map((receipt, index) => {
    const result = validateReceipt(receipt);
    if (!result.valid) {
      throw new ValidationError(`Receipt at index ${index} failed validation`, result.errors);
    }
    return { ...receipt };
  });

  const exportedAt = options.exportedAt
    ? normalizeTimestamp(options.exportedAt)
    : resolveNow(options.clock ?? options.now);
  if (!exportedAt) {
    throw new BackupError("Backup export time is invalid", "INVALID_TIMESTAMP");
  }

  return JSON.stringify(
    {
      type: BACKUP_KIND,
      version: SCHEMA_VERSION,
      exportedAt,
      receipts: validated,
    },
    null,
    2,
  );
}

function protectSpreadsheetFormula(value) {
  if (typeof value !== "string") {
    return value;
  }
  const withoutLeadingSpace = value.trimStart();
  if (/^[=+\-@]/.test(withoutLeadingSpace) || /^[\t\r\n]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function quoteCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCSV(receipts, options = {}) {
  if (!Array.isArray(receipts)) {
    throw new ValidationError("Receipts must be an array", [
      validationError("receipts", "INVALID_TYPE", "Receipts must be an array", receipts),
    ]);
  }

  const rows = receipts.map((receipt, index) => {
    const result = validateReceipt(receipt);
    if (!result.valid) {
      throw new ValidationError(`Receipt at index ${index} failed validation`, result.errors);
    }
    return [
      receipt.id,
      receipt.date,
      receipt.merchant,
      receipt.total,
      receipt.vat ?? 0,
      receipt.invoiceNumber ?? "",
      receipt.paymentMethod ?? "",
      receipt.category ?? "",
      receipt.notes ?? "",
      receipt.createdAt ?? "",
      receipt.updatedAt ?? "",
    ];
  });

  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(row.map((value) => quoteCsvCell(protectSpreadsheetFormula(value))).join(","));
  }

  const prefix = options.bom === false ? "" : UTF8_BOM;
  return `${prefix}${lines.join("\r\n")}\r\n`;
}

export const exportCSV = toCSV;
export const receiptsToCSV = toCSV;

export function exportBackup(source, options = {}) {
  const receipts = source instanceof ReceiptStorage ? source.list() : source;
  return serializeBackup(receipts, options);
}

function isStorageAdapter(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.getItem === "function" &&
    typeof value.setItem === "function"
  );
}

export function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [String(key), String(value)]));
  return {
    getItem(key) {
      return values.has(String(key)) ? values.get(String(key)) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
    clear() {
      values.clear();
    },
    get length() {
      return values.size;
    },
  };
}

function defaultStorageAdapter() {
  try {
    if (globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    return createMemoryStorage();
  }
  return createMemoryStorage();
}

function classifyStorageError(error, fallbackCode) {
  const message = String(error?.message ?? error ?? "");
  const quotaCodes = new Set([22, 1014]);
  if (
    error?.name === "QuotaExceededError" ||
    error?.code === "QUOTA_EXCEEDED" ||
    quotaCodes.has(error?.code) ||
    /quota|storage\s+(?:is\s+)?full|exceeded the quota/i.test(message)
  ) {
    return "QUOTA_EXCEEDED";
  }
  if (error?.name === "SecurityError" || error?.code === "ACCESS_DENIED") {
    return "ACCESS_DENIED";
  }
  return fallbackCode;
}

function storageWriteError(error) {
  const code = classifyStorageError(error, "WRITE_FAILED");
  const message = code === "QUOTA_EXCEEDED"
    ? "Storage quota exceeded while writing the receipt ledger"
    : code === "ACCESS_DENIED"
      ? "Storage access was denied while writing the receipt ledger"
      : "Unable to write the receipt ledger";
  return new StorageError(message, code, error);
}

function cloneReceipt(receipt) {
  return receipt ? { ...receipt } : null;
}

export class ReceiptStorage {
  constructor(adapterOrOptions = {}, additionalOptions = {}) {
    const options = isStorageAdapter(adapterOrOptions)
      ? { ...additionalOptions, storage: adapterOrOptions }
      : { ...(adapterOrOptions ?? {}) };

    this.storage = options.storage ?? options.storageAdapter ?? options.adapter ?? defaultStorageAdapter();
    this.key = options.key ?? options.storageKey ?? STORAGE_KEY;
    this.corruptKey = options.corruptKey ?? `${this.key}.corrupt`;
    this.idFactory = options.idFactory ?? options.idGenerator ?? options.generateId ?? defaultIdFactory;
    this.clock = options.clock ?? options.now ?? (() => new Date());
    this.receipts = [];
    this.status = {
      state: "empty",
      version: SCHEMA_VERSION,
      receiptCount: 0,
      discardedCount: 0,
      quarantined: false,
      lastError: null,
    };
    this.#load();
  }

  #load() {
    let raw;
    try {
      raw = this.storage.getItem(this.key);
    } catch (error) {
      this.status = {
        ...this.status,
        state: "error",
        lastError: { code: "READ_FAILED", message: error.message ?? String(error) },
      };
      return;
    }

    if (raw === null || raw === undefined) {
      this.status = { ...this.status, state: "empty" };
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(stripBom(String(raw)));
    } catch (error) {
      this.#recoverCorrupt(String(raw), error);
      return;
    }

    let migrated;
    try {
      migrated = migrateData(parsed, { idFactory: this.idFactory, now: this.clock });
    } catch (error) {
      if (error instanceof UnsupportedVersionError) {
        this.status = {
          ...this.status,
          state: "unsupported",
          version: error.version,
          lastError: { code: error.code, message: error.message },
        };
        return;
      }
      this.#recoverCorrupt(String(raw), error);
      return;
    }

    this.receipts = migrated.receipts;
    const needsRepair = migrated.sourceVersion < SCHEMA_VERSION || migrated.discarded.length > 0;
    this.status = {
      ...this.status,
      state: needsRepair ? "repaired" : "loaded",
      version: SCHEMA_VERSION,
      receiptCount: this.receipts.length,
      discardedCount: migrated.discarded.length,
    };

    if (!needsRepair) {
      return;
    }

    if (migrated.discarded.length > 0) {
      try {
        this.storage.setItem(this.corruptKey, String(raw));
        this.status = { ...this.status, quarantined: true };
      } catch (error) {
        this.status = {
          ...this.status,
          lastError: {
            code: classifyStorageError(error, "WRITE_FAILED"),
            message: error.message ?? String(error),
          },
        };
        return;
      }
    }

    try {
      this.#persist(this.receipts);
    } catch (error) {
      this.status = {
        ...this.status,
        lastError: { code: error.code, message: error.message },
      };
    }
  }

  #recoverCorrupt(raw, cause) {
    try {
      this.storage.setItem(this.corruptKey, raw);
    } catch (error) {
      this.status = {
        ...this.status,
        state: "error",
        lastError: {
          code: classifyStorageError(error, "WRITE_FAILED"),
          message: error.message ?? String(error),
        },
      };
      return;
    }

    try {
      this.storage.setItem(this.key, JSON.stringify({ version: SCHEMA_VERSION, receipts: [] }));
    } catch (error) {
      this.status = {
        ...this.status,
        state: "error",
        quarantined: true,
        lastError: {
          code: classifyStorageError(error, "WRITE_FAILED"),
          message: error.message ?? String(error),
        },
      };
      return;
    }

    this.receipts = [];
    this.status = {
      ...this.status,
      state: "recovered",
      version: SCHEMA_VERSION,
      receiptCount: 0,
      discardedCount: 0,
      quarantined: true,
      lastError: { code: "CORRUPT_DATA", message: cause.message ?? String(cause) },
    };
  }

  #persist(receipts) {
    const serialized = JSON.stringify({ version: SCHEMA_VERSION, receipts });
    try {
      this.storage.setItem(this.key, serialized);
    } catch (error) {
      throw storageWriteError(error);
    }
  }

  get count() {
    return this.receipts.length;
  }

  getStatus() {
    return { ...this.status };
  }

  list(options = {}) {
    const month = typeof options.month === "string" ? options.month : "";
    const category = typeof options.category === "string" ? options.category.toLowerCase() : "";
    const search = String(options.search ?? options.query ?? "").trim().toLowerCase();

    let filtered = this.receipts.filter((receipt) => {
      if (month && !receipt.date.startsWith(month)) {
        return false;
      }
      if (category && receipt.category.toLowerCase() !== category) {
        return false;
      }
      if (search) {
        const haystack = [
          receipt.id,
          receipt.merchant,
          receipt.invoiceNumber,
          receipt.paymentMethod,
          receipt.category,
          receipt.notes,
        ].join("\n").toLowerCase();
        if (!haystack.includes(search)) {
          return false;
        }
      }
      return true;
    });

    const sort = options.sort ?? "date-desc";
    filtered = [...filtered].sort((left, right) => {
      if (sort === "date-asc") {
        return left.date.localeCompare(right.date) || left.createdAt.localeCompare(right.createdAt);
      }
      if (sort === "created-asc") {
        return left.createdAt.localeCompare(right.createdAt);
      }
      if (sort === "created-desc") {
        return right.createdAt.localeCompare(left.createdAt);
      }
      if (sort === "merchant") {
        return left.merchant.localeCompare(right.merchant, "vi");
      }
      return right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt);
    });

    const offset = Number.isInteger(options.offset) && options.offset > 0 ? options.offset : 0;
    const limit = Number.isInteger(options.limit) && options.limit >= 0 ? options.limit : filtered.length;
    return filtered.slice(offset, offset + limit).map(cloneReceipt);
  }

  listReceipts(options = {}) {
    return this.list(options);
  }

  getAll(options = {}) {
    return this.list(options);
  }

  get(id) {
    const receipt = this.receipts.find((candidate) => candidate.id === id);
    return cloneReceipt(receipt);
  }

  getReceipt(id) {
    return this.get(id);
  }

  add(receipt) {
    const sanitized = sanitizeReceipt(receipt, { idFactory: this.idFactory, now: this.clock });
    if (this.receipts.some((candidate) => candidate.id === sanitized.id)) {
      throw new ValidationError(`Receipt id ${sanitized.id} already exists`, [
        validationError("id", "DUPLICATE_ID", `Receipt id ${sanitized.id} already exists`, sanitized.id),
      ]);
    }
    const candidate = [...this.receipts, sanitized];
    this.#persist(candidate);
    this.receipts = candidate;
    this.status = { ...this.status, receiptCount: this.receipts.length };
    return cloneReceipt(sanitized);
  }

  addReceipt(receipt) {
    return this.add(receipt);
  }

  update(id, changes) {
    const index = this.receipts.findIndex((receipt) => receipt.id === id);
    if (index === -1) {
      throw new ValidationError(`Receipt ${id} does not exist`, [
        validationError("id", "NOT_FOUND", `Receipt ${id} does not exist`, id),
      ]);
    }
    if (!isPlainObject(changes)) {
      throw new ValidationError("Receipt changes must be a plain object", [
        validationError("changes", "INVALID_TYPE", "Receipt changes must be a plain object", changes),
      ]);
    }

    const current = this.receipts[index];
    const merged = { ...current };
    const mappedChanges = mapLegacyFields(changes);
    for (const field of Object.keys(RECEIPT_ALIASES)) {
      if (hasOwn(mappedChanges, field) && mappedChanges[field] !== undefined) {
        merged[field] = mappedChanges[field];
      }
    }
    merged.id = current.id;
    merged.createdAt = current.createdAt;
    merged.updatedAt = resolveNow(this.clock);
    const sanitized = sanitizeReceipt(merged, { idFactory: this.idFactory, now: this.clock });
    const candidate = [...this.receipts];
    candidate[index] = sanitized;
    this.#persist(candidate);
    this.receipts = candidate;
    return cloneReceipt(sanitized);
  }

  updateReceipt(id, changes) {
    return this.update(id, changes);
  }

  delete(id) {
    const index = this.receipts.findIndex((receipt) => receipt.id === id);
    if (index === -1) {
      return false;
    }
    const candidate = this.receipts.filter((receipt) => receipt.id !== id);
    this.#persist(candidate);
    this.receipts = candidate;
    this.status = { ...this.status, receiptCount: this.receipts.length };
    return true;
  }

  deleteReceipt(id) {
    return this.delete(id);
  }

  removeReceipt(id) {
    return this.delete(id);
  }

  clear() {
    this.#persist([]);
    this.receipts = [];
    this.status = { ...this.status, receiptCount: 0 };
    return true;
  }

  replaceAll(receipts) {
    if (!Array.isArray(receipts)) {
      throw new ValidationError("Receipts must be an array", [
        validationError("receipts", "INVALID_TYPE", "Receipts must be an array", receipts),
      ]);
    }
    const sanitized = receipts.map((receipt) =>
      sanitizeReceipt(receipt, { idFactory: this.idFactory, now: this.clock }),
    );
    const ids = new Set();
    for (const receipt of sanitized) {
      if (ids.has(receipt.id)) {
        throw new ValidationError(`Receipt id ${receipt.id} already exists`, [
          validationError("id", "DUPLICATE_ID", `Receipt id ${receipt.id} already exists`, receipt.id),
        ]);
      }
      ids.add(receipt.id);
    }
    this.#persist(sanitized);
    this.receipts = sanitized;
    this.status = { ...this.status, receiptCount: this.receipts.length };
    return sanitized.map(cloneReceipt);
  }

  exportCSV(options = {}) {
    return toCSV(this.receipts, options);
  }

  exportBackup(options = {}) {
    return serializeBackup(this.receipts, {
      ...options,
      clock: options.clock ?? options.now ?? this.clock,
    });
  }

  importBackup(serialized, options = {}) {
    const incoming = parseBackup(serialized, { idFactory: this.idFactory, now: this.clock });
    const mode = options.mode ?? "merge";
    if (mode !== "merge" && mode !== "replace") {
      throw new BackupError(`Unknown backup import mode ${mode}`, "INVALID_IMPORT_MODE");
    }

    let candidate;
    if (mode === "merge") {
      const existingIds = new Set(this.receipts.map((receipt) => receipt.id));
      const duplicateIds = incoming
        .map((receipt) => receipt.id)
        .filter((id) => existingIds.has(id));
      if (duplicateIds.length > 0) {
        throw new DuplicateReceiptError(duplicateIds);
      }
      candidate = [...this.receipts, ...incoming];
    } else {
      candidate = incoming;
    }

    this.#persist(candidate);
    this.receipts = candidate;
    this.status = { ...this.status, receiptCount: this.receipts.length };
    return {
      imported: incoming.length,
      total: candidate.length,
      mode,
      receipts: incoming.map(cloneReceipt),
    };
  }
}

export const LedgerStorage = ReceiptStorage;

export function importBackup(serialized, target, options = {}) {
  if (target instanceof ReceiptStorage) {
    return target.importBackup(serialized, options);
  }
  if (isStorageAdapter(target)) {
    return new ReceiptStorage({
      ...options,
      storage: target,
    }).importBackup(serialized, options);
  }
  const incoming = parseBackup(serialized, options);
  if (Array.isArray(target)) {
    const duplicateIds = target
      .map((receipt) => receipt.id)
      .filter((id) => incoming.some((receipt) => receipt.id === id));
    if (duplicateIds.length > 0) {
      throw new DuplicateReceiptError(duplicateIds);
    }
    return [...target, ...incoming];
  }
  return incoming;
}

export default ReceiptStorage;
