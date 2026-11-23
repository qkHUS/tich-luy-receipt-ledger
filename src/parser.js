const AMOUNT_TOKEN_SOURCE = "(?<![\\p{L}\\p{N}])(?:\\(?[+\\-−]?\\s*)?[0-9OoDdIl|](?:[0-9OoDdIl|.,'’]*[0-9OoDdIl|])?(?:\\s?(?:₫$€£¥|VND|VNĐ|DONG))?(?![\\p{L}\\p{N}])";

const MONTH_NAMES = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const MONTH_NAME_SOURCE = Object.keys(MONTH_NAMES)
  .sort((left, right) => right.length - left.length)
  .join("|");

const CATEGORY_RULES = [
  {
    category: "food",
    patterns: [
      /cà phê|coffee|café|cafe|quán ăn|nhà hàng|restaurant|burger|pizza|food court|bakery|tiệm bánh|trà sữa|tea house|bánh mì|grocery/iu,
    ],
  },
  {
    category: "transport",
    patterns: [
      /grab|uber|taxi|xe ôm|xe om|xe buýt|bus|metro|train|xe lửa|gasoline|xăng|petrol|fuel|gas station|parking|phí gửi xe|đỗ xe|vận tải|shipping|delivery|giao hàng|vinfast|\bshell\b/iu,
    ],
  },
  {
    category: "utilities",
    patterns: [
      /điện lực|electricity|electric|water|internet|broadband|telecom|viễn thông|viettel|vina|mobifone|truyền hình|cable|\bfpt\b|\bevn\b/iu,
    ],
  },
  {
    category: "health",
    patterns: [
      /nhà thuốc|y tế|hospital|clinic|medical|pharmacy|drugstore|thuốc/iu,
    ],
  },
  {
    category: "education",
    patterns: [
      /nhà sách|bookstore|school|university|education|training|course|học viện|trường|trung tâm/iu,
    ],
  },
  {
    category: "entertainment",
    patterns: [
      /cinema|movie|theatre|theater|game|giải trí|streaming|netflix|concert/iu,
    ],
  },
  {
    category: "travel",
    patterns: [
      /khách sạn|hotel|airline|flight|motel|du lịch|travel|resort/iu,
    ],
  },
  {
    category: "office",
    patterns: [
      /văn phòng phẩm|office supply|stationery|giấy văn phòng/iu,
    ],
  },
  {
    category: "services",
    patterns: [
      /dịch vụ|services|repair|maintenance|consulting|tư vấn/iu,
    ],
  },
  {
    category: "shopping",
    patterns: [
      /bách hóa|bach hoa|siêu thị|sieu thi|supermarket|minimart|convenience store|vinmart|co\.?opmart|circle k|quần áo|clothing|apparel|department store|retail/iu,
    ],
  },
];

const PAYMENT_METHOD_PATTERNS = [
  /ví\s*(?:điện\s*tử|diện\s*tử)|e[\s-]?wallet|mobile wallet|momo|zalo\s*pay|zalopay|vnpay|paypal|apple pay|google pay/iu,
  /chuyển\s*khoản|chuyen\s*khoan|bank transfer|internet banking|ngân\s*hàng|ngan\s*hang/iu,
  /thẻ\s*ghi\s*nợ|the\s*ghi\s*no|debit card|atm card|thẻ\s*atm|the\s*atm/iu,
  /thẻ\s*tín\s*dụng|the\s*tin\s*dung|credit card|mastercard|master card|\bvisa\b|\bamex\b/iu,
  /tiền\s*mặt|tien\s*mat|mặt\s*tiền|mat\s*tien|\bcash\b/iu,
  /\b(?:thẻ|card)\b/iu,
];

function asText(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function collapseWhitespace(value) {
  return value.replace(/[\t\f\v ]+/g, " ").trim();
}

function fullWidthDigits(value) {
  return value.replace(/[０-９]/gu, (digit) =>
    String.fromCharCode(digit.charCodeAt(0) - 0xff10 + 0x30),
  );
}

/**
 * Convert text to an uppercase, accent-free comparison form. Common Vietnamese
 * characters are folded one-to-one, so match offsets remain useful on the
 * original line.
 */
function foldText(value) {
  let folded = "";
  for (const character of value) {
    if (character === "đ") {
      folded += "D";
      continue;
    }
    if (character === "Đ") {
      folded += "D";
      continue;
    }
    const base = character.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
    folded += base || character;
  }
  return folded;
}

/**
 * Normalize OCR text into meaningful, whitespace-collapsed lines.
 *
 * @param {string|string[]} text
 * @returns {string[]}
 */
export function normalizeLines(text) {
  const source = Array.isArray(text) ? text.join("\n") : asText(text);
  return source
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\u2060\ufeff]/gu, "")
    .split("\n")
    .map((line) => collapseWhitespace(line))
    .filter(Boolean);
}

function linesFrom(value) {
  return Array.isArray(value) ? normalizeLines(value) : normalizeLines(asText(value));
}

function stripCurrencyWords(value) {
  return value
    .replace(/\b(?:VND|VNĐ|USD|EUR|GBP|JPY|CNY|DONG)\b/giu, " ")
    .replace(/đ/giu, " ")
    .replace(/[₫$€£¥]/gu, " ")
    .replace(/(^|[\s:])D(?=$|[\s.,])/giu, "$1");
}

function compactSpacedThousands(value) {
  return value.replace(/(?<=\d)[ \t](?=\d{3}(?:\D|$))/gu, "");
}

function findAmountTokens(value) {
  const source = compactSpacedThousands(fullWidthDigits(asText(value)));
  const pattern = new RegExp(AMOUNT_TOKEN_SOURCE, "giu");
  const tokens = [];

  for (const match of source.matchAll(pattern)) {
    const token = match[0];
    const hasDigit = /\d/u.test(token);
    const isOcrOnly = /^[OoDd]+$/u.test(token);
    if (!hasDigit && !isOcrOnly) continue;

    const before = source.slice(Math.max(0, match.index - 4), match.index);
    const after = source.slice(match.index + token.length);
    const hasCurrency =
      /[₫$€£¥]/u.test(before) || /(?:VND|VNĐ|DONG)\b/iu.test(after);
    const isPercent = /^\s*%/u.test(after);

    tokens.push({
      token,
      index: match.index,
      hasCurrency,
      isPercent,
    });
  }

  return tokens;
}

function parseNumericToken(token) {
  let core = token
    .replace(/[₫$€£¥]/gu, "")
    .replace(/\b(?:VND|VNĐ|DONG)\b/giu, "")
    .replace(/[^0-9OoDdIl|.,'+-]/gu, "")
    .replace(/[’']/gu, "")
    .replace(/O/gu, "0")
    .replace(/D/gu, "0")
    .replace(/[Il|]/gu, "1");

  if (!core) return null;

  let negative = false;
  if (/^\(/u.test(core) && /\)$/u.test(core)) {
    negative = true;
    core = core.slice(1, -1);
  }
  if (core.startsWith("-")) {
    negative = true;
    core = core.slice(1);
  } else if (core.startsWith("+")) {
    core = core.slice(1);
  }

  core = core.replace(/[\s]/gu, "");
  if (!/\d/u.test(core)) return null;

  const lastDot = core.lastIndexOf(".");
  const lastComma = core.lastIndexOf(",");
  let integerPart = "";
  let fractionPart = "";

  if (lastDot >= 0 && lastComma >= 0) {
    const decimalSeparator = lastDot > lastComma ? "." : ",";
    const decimalIndex = Math.max(lastDot, lastComma);
    integerPart = core.slice(0, decimalIndex).replace(/[.,]/gu, "");
    fractionPart = core.slice(decimalIndex + 1).replace(/[.,]/gu, "");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const separator = lastDot >= 0 ? "." : ",";
    const parts = core.split(separator);
    const lastPart = parts.at(-1) ?? "";
    const leadingParts = parts.slice(0, -1);
    const groupedThousands =
      parts.length > 1 && parts.slice(1).every((part) => part.length === 3);

    if (parts.length === 1 || groupedThousands || lastPart.length > 2) {
      integerPart = parts.join("");
    } else {
      integerPart = leadingParts.join("");
      fractionPart = lastPart;
    }
  } else {
    integerPart = core;
  }

  if (!integerPart) integerPart = "0";
  if (!/^\d+$/u.test(integerPart)) return null;
  if (fractionPart && !/^\d+$/u.test(fractionPart)) return null;

  const numeric = Number(fractionPart ? `${integerPart}.${fractionPart}` : integerPart);
  if (!Number.isFinite(numeric)) return null;
  return negative ? -numeric : numeric;
}

/**
 * Parse one monetary value without using locale-dependent Intl behavior.
 * Vietnamese grouping is preferred: `1.234` means 1234, while a comma with
 * one or two trailing digits is treated as a decimal separator.
 *
 * @param {string|number} value
 * @returns {number|null}
 */
export function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const source = fullWidthDigits(asText(value)).trim();
  if (!source) return null;

  const prepared = stripCurrencyWords(source);
  const tokens = findAmountTokens(prepared);
  const token = tokens.find((candidate) => /\d/u.test(candidate.token));
  if (token) return parseNumericToken(token.token);

  if (/^[OoDd\s().+-]+$/u.test(prepared)) {
    const ocrToken = prepared.replace(/[^OoDd]/gu, "");
    return ocrToken ? parseNumericToken(ocrToken) : null;
  }

  return null;
}

function amountTokenScore(candidate) {
  const digits = candidate.token.match(/\d/gu)?.length ?? 0;
  let score = Math.min(digits, 12);

  if (candidate.hasCurrency) score += 25;
  if (/^\d{1,3}(?:[.,]\d{3})+$/u.test(candidate.token)) score += 18;
  if (candidate.isPercent) score -= 30;
  if (/[.,]\d{1,2}$/u.test(candidate.token)) score += 8;

  const value = parseNumericToken(candidate.token);
  if (value !== null && Math.abs(value) >= 1000) score += 10;
  if (value !== null && Math.abs(value) < 1000 && digits <= 3) score -= 2;

  return score;
}

function bestAmount(value) {
  return findAmountTokens(value)
    .filter((candidate) => !candidate.isPercent)
    .map((candidate) => ({
      ...candidate,
      value: parseNumericToken(candidate.token),
      score: amountTokenScore(candidate),
    }))
    .filter((candidate) => candidate.value !== null)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (Math.abs(right.value) !== Math.abs(left.value)) {
        return Math.abs(right.value) - Math.abs(left.value);
      }
      return left.index - right.index;
    })[0] ?? null;
}

function isMoneyLike(amount) {
  if (!amount) return false;
  if (amount.hasCurrency) return true;
  if (/^\d{1,3}(?:[.,]\d{3})+$/u.test(amount.token)) return true;
  return Math.abs(amount.value) >= 1000;
}

function classifySubtotalLine(line) {
  const folded = foldText(line);
  const patterns = [
    /\bSUB\s*TOTAL\b/u,
    /\bTAM\s*(?:TINH|CONG)\b/u,
    /\bTONG\s+TRUOC(?:\s+(?:VAT|THUE))?\b/u,
    /\bTONG\s+TIEN\s+HANG\b/u,
    /\bTIEN\s+HANG\s+TONG\b/u,
    /\bTOTAL\s+(?:BEFORE|EXCLUDING)\s+(?:VAT|TAX)\b/u,
  ];

  for (const pattern of patterns) {
    const match = folded.match(pattern);
    if (match) {
      return {
        folded,
        label: match[0],
        weight: 75,
        tail: line.slice(match.index + match[0].length),
      };
    }
  }
  return null;
}

function classifyTotalLine(line) {
  const folded = foldText(line);
  const subtotal = classifySubtotalLine(line);
  if (subtotal) return { ...subtotal, explicit: false };

  if (/\bPHUONG\s+THUC\b/u.test(folded) && /\bTHANH\s+TOAN\b/u.test(folded)) {
    return null;
  }
  if (/\bTONG\s+(?:SO\s+)?LUONG\b/u.test(folded)) return null;
  if (/\bTOTAL\s+(?:ITEMS?|QUANTITY|QUANTITIES)\b/u.test(folded)) return null;
  if (/\bTONG\s+(?:KHUYEN\s*MAI|GIAM\s*GIA)\b/u.test(folded)) return null;
  if (/\bTOTAL\s+DISCOUNT\b/u.test(folded)) return null;

  const definitions = [
    { pattern: /\bTONG\s+THANH\s+TOAN\b/u, weight: 105 },
    { pattern: /\bTHANH\s+TOAN\b/u, weight: 104 },
    { pattern: /\bGRAND\s+TOTAL\b/u, weight: 103 },
    { pattern: /\b(?:AMOUNT|BALANCE|TOTAL)\s+DUE\b/u, weight: 102 },
    { pattern: /\bTONG\s+CONG\b/u, weight: 101 },
    { pattern: /\bTO\s+PAY\b/u, weight: 100 },
    { pattern: /\bTOTAL\s+AMOUNT\b/u, weight: 100 },
    { pattern: /\bTONG\s+TIEN\b/u, weight: 98 },
    { pattern: /\bTOTAL\b/u, weight: 97 },
    { pattern: /\bTONG\b/u, weight: 90 },
  ];

  for (const definition of definitions) {
    const match = folded.match(definition.pattern);
    if (!match) continue;

    if (
      /\b(?:TONG|TOTAL)\s+(?:VAT|GTGT|TAX)\b/u.test(folded) ||
      /\b(?:VAT|GTGT|TAX)\s+(?:AMOUNT\s+)?TOTAL\b/u.test(folded)
    ) {
      return null;
    }

    return {
      folded,
      label: match[0],
      weight: definition.weight,
      tail: line.slice(match.index + match[0].length),
      explicit: true,
    };
  }

  return null;
}

function candidateFromLine(lines, lineIndex, classification) {
  const sameLine = bestAmount(classification.tail);
  if (sameLine) {
    return {
      value: sameLine.value,
      lineIndex,
      label: classification.label,
      weight: classification.weight,
      score: sameLine.score,
    };
  }

  const nextLine = lines[lineIndex + 1];
  if (!nextLine) return null;
  const nextClassification = classifyTotalLine(nextLine);
  if (nextClassification) return null;

  const nextAmount = bestAmount(nextLine);
  if (!nextAmount) return null;

  const tailIsEmpty = classification.tail.trim().length === 0;
  const hasSeparator = /^[:\-=]/u.test(classification.tail.trimStart());
  if (!tailIsEmpty && !hasSeparator && !isMoneyLike(nextAmount)) return null;
  if (!hasSeparator && !isMoneyLike(nextAmount)) return null;

  return {
    value: nextAmount.value,
    lineIndex: lineIndex + 1,
    label: classification.label,
    weight: classification.weight,
    score: nextAmount.score,
  };
}

function selectTotalCandidate(candidates) {
  return [...candidates].sort((left, right) => {
    if (right.weight !== left.weight) return right.weight - left.weight;
    if (right.lineIndex !== left.lineIndex) return right.lineIndex - left.lineIndex;
    return right.score - left.score;
  })[0] ?? null;
}

function extractTotalDetails(lines) {
  const explicit = [];
  const subtotal = [];

  lines.forEach((line, lineIndex) => {
    const classification = classifyTotalLine(line);
    if (!classification) return;
    const candidate = candidateFromLine(lines, lineIndex, classification);
    if (!candidate) return;
    if (classification.explicit) explicit.push(candidate);
    else subtotal.push(candidate);
  });

  const explicitTotal = selectTotalCandidate(explicit);
  if (explicitTotal) {
    return {
      value: explicitTotal.value,
      confidence: 0.99,
      source: explicitTotal.label,
    };
  }

  const subtotalTotal = selectTotalCandidate(subtotal);
  if (subtotalTotal) {
    return {
      value: subtotalTotal.value,
      confidence: 0.58,
      source: subtotalTotal.label,
    };
  }

  const fallback = [];
  lines.forEach((line, lineIndex) => {
    const folded = foldText(line);
    if (
      /\b(?:NGAY|DATE|MST|MA\s+SO\s+THUE|TAX\s+(?:CODE|ID|NO)|SO\s+LUONG|QTY|PHONE|SODT|TEL)\b/u.test(
        folded,
      ) ||
      /\b(?:HOA\s+DON|INVOICE(?:\s+(?:NO|NUM|NUMBER|ID))?|ORDER(?:\s+(?:NO|ID|NUM|NUMBER))?|BILL(?:\s+(?:NO|NUM|NUMBER|ID))?|MA\s+(?:HOA\s+DON|DON|HD))\b/u.test(
        folded,
      ) ||
      /\b(?:VAT|GTGT)\b/u.test(folded) ||
      /\b(?:DIA\s+CHI|ADDRESS|PHUONG\s+THUC|PAYMENT)\b/u.test(folded) ||
      /\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/u.test(folded)
    ) {
      return;
    }

    for (const token of findAmountTokens(line)) {
      if (token.isPercent) continue;
      const value = parseNumericToken(token.token);
      if (value === null || value <= 0) continue;
      fallback.push({
        value,
        lineIndex,
        label: null,
        weight: 0,
        score: amountTokenScore(token) + Math.min(Math.log10(value + 1), 12),
      });
    }
  });

  const fallbackTotal = selectTotalCandidate(fallback);
  if (!fallbackTotal) return { value: null, confidence: 0, source: null };
  return {
    value: fallbackTotal.value,
    confidence: 0.42,
    source: null,
  };
}

/**
 * Extract the receipt total. Explicit total labels always outrank subtotal
 * labels and unlabelled monetary values.
 *
 * @param {string|string[]} text
 * @returns {number|null}
 */
export function extractTotal(text) {
  return extractTotalDetails(linesFrom(text)).value;
}

function classifyVatLine(line) {
  const folded = foldText(line);
  if (
    /\b(?:TAX\s+(?:CODE|ID|NO)|TAX\s+INVOICE|MA\s+SO\s+THUE|MST)\b/u.test(folded)
  ) {
    return null;
  }
  if (
    /\bHOA\s+DON(?:\s+(?:GTGT|VAT|GIA\s+(?:TRI|THUE)\s+GIA\s+TANG))?\b/u.test(
      folded,
    ) ||
    /\bVAT\s+INVOICE\b/u.test(folded)
  ) {
    return null;
  }

  const definitions = [
    { pattern: /\bGIA\s+(?:TRI|THUE)\s+GIA\s+TANG\b/u, confidence: 0.98 },
    { pattern: /\bTHUE\s+(?:GTGT|GIA\s+(?:TRI|THUE)\s+GIA\s+TANG)\b/u, confidence: 0.98 },
    { pattern: /\bVAT(?:\s*\/\s*GTGT)?\b/u, confidence: 0.97 },
    { pattern: /\bGTGT\b/u, confidence: 0.97 },
    { pattern: /\bSALES\s+TAX\b/u, confidence: 0.96 },
    { pattern: /\bTAX\s+AMOUNT\b/u, confidence: 0.96 },
    { pattern: /\bTAX\b/u, confidence: 0.88 },
  ];

  for (const definition of definitions) {
    const match = folded.match(definition.pattern);
    if (!match) continue;
    return {
      folded,
      label: match[0],
      confidence: definition.confidence,
      tail: line.slice(match.index + match[0].length),
    };
  }
  return null;
}

function extractVatDetails(lines) {
  const candidates = [];

  lines.forEach((line, lineIndex) => {
    const classification = classifyVatLine(line);
    if (!classification) return;

    const sameLine = bestAmount(classification.tail);
    if (sameLine) {
      candidates.push({
        value: sameLine.value,
        lineIndex,
        confidence: classification.confidence,
      });
      return;
    }

    const nextLine = lines[lineIndex + 1];
    if (!nextLine) return;
    const nextAmount = bestAmount(nextLine);
    if (nextAmount && isMoneyLike(nextAmount)) {
      candidates.push({
        value: nextAmount.value,
        lineIndex: lineIndex + 1,
        confidence: classification.confidence - 0.04,
      });
    }
  });

  const selected = [...candidates].sort((left, right) => {
    if (right.lineIndex !== left.lineIndex) return right.lineIndex - left.lineIndex;
    return right.confidence - left.confidence;
  })[0];

  if (!selected) return { value: null, confidence: 0, source: null };
  return {
    value: selected.value,
    confidence: selected.confidence,
    source: "VAT",
  };
}

/**
 * Extract a monetary VAT/GTGT amount. A percentage without a monetary amount
 * is intentionally not treated as a VAT value.
 *
 * @param {string|string[]} text
 * @returns {number|null}
 */
export function extractVat(text) {
  return extractVatDetails(linesFrom(text)).value;
}

function isValidDateParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maximumDay = month === 2 && leap ? 29 : days[month - 1];
  return day <= maximumDay;
}

function normalizeYear(year) {
  if (year >= 100) return year;
  return year <= 68 ? 2000 + year : 1900 + year;
}

function isoDate(year, month, day) {
  if (!isValidDateParts(year, month, day)) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isDateLabel(folded) {
  return /\b(?:NGAY|DATE|ISSUED(?:\s+ON)?|TRANSACTION(?:\s+DATE)?|PURCHASE(?:\s+DATE)?|THOI\s+GIAN)\b/u.test(
    folded,
  );
}

function isExpiryLine(folded) {
  return /\b(?:HSD|EXP(?:IRY)?|VALID\s+UNTIL|EXPIRES|HET\s+HAN)\b/u.test(folded);
}

function extractDateDetails(lines) {
  const candidates = [];

  for (const line of lines) {
    const folded = foldText(line);
    if (isExpiryLine(folded)) continue;
    const labeled = isDateLabel(folded);

    const isoMatches = line.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/gu);
    for (const match of isoMatches) {
      const value = isoDate(
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
      );
      if (!value) continue;
      candidates.push({
        value,
        confidence: labeled ? 0.99 : 0.97,
        lineIndex: candidates.length,
      });
    }

    const numericMatches = line.matchAll(
      /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/gu,
    );
    for (const match of numericMatches) {
      const first = Number(match[1]);
      const second = Number(match[2]);
      const year = normalizeYear(Number(match[3]));
      const isMonthFirst = second > 12 && first <= 12;
      const month = isMonthFirst ? first : second;
      const day = isMonthFirst ? second : first;
      const value = isoDate(year, month, day);
      if (!value) continue;
      candidates.push({
        value,
        confidence: labeled ? 0.99 : isMonthFirst ? 0.95 : 0.97,
        lineIndex: candidates.length,
      });
    }

    const dayMonthMatches = line.matchAll(
      new RegExp(
        `\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s./-]+(${MONTH_NAME_SOURCE})[\\s,./-]+(\\d{4})\\b`,
        "giu",
      ),
    );
    for (const match of dayMonthMatches) {
      const monthName = match[2].slice(0, 3).toLowerCase();
      const value = isoDate(Number(match[3]), MONTH_NAMES[monthName], Number(match[1]));
      if (!value) continue;
      candidates.push({
        value,
        confidence: labeled ? 0.99 : 0.97,
        lineIndex: candidates.length,
      });
    }

    const monthDayMatches = line.matchAll(
      new RegExp(
        `\\b(${MONTH_NAME_SOURCE})[\\s,./-]+(\\d{1,2})(?:st|nd|rd|th)?[\\s,./-]+(\\d{4})\\b`,
        "giu",
      ),
    );
    for (const match of monthDayMatches) {
      const monthName = match[1].slice(0, 3).toLowerCase();
      const value = isoDate(Number(match[3]), MONTH_NAMES[monthName], Number(match[2]));
      if (!value) continue;
      candidates.push({
        value,
        confidence: labeled ? 0.99 : 0.97,
        lineIndex: candidates.length,
      });
    }
  }

  const selected = candidates.sort((left, right) => {
    if (right.confidence !== left.confidence) return right.confidence - left.confidence;
    return left.lineIndex - right.lineIndex;
  })[0];

  if (!selected) return { value: null, confidence: 0, source: null };
  return { value: selected.value, confidence: selected.confidence, source: "date" };
}

/**
 * Extract a calendar date as an ISO `YYYY-MM-DD` string. Numeric dates are
 * interpreted as DD/MM/YYYY unless the day value makes that impossible.
 *
 * @param {string|string[]} text
 * @returns {string|null}
 */
export function extractDate(text) {
  return extractDateDetails(linesFrom(text)).value;
}

function cleanMerchantValue(value) {
  return collapseWhitespace(
    value
      .replace(/^[\s:;#*\-–—]+/u, "")
      .replace(/[\s:;#*\-–—]+$/u, ""),
  );
}

function classifyMerchantLine(line) {
  const folded = foldText(line);
  const patterns = [
    /\bTEN\s+CUA\s+HANG\b/u,
    /\bCUA\s+HANG\b/u,
    /\bMERCHANT\b/u,
    /\bSTORE\b/u,
    /\bSHOP\b/u,
  ];

  for (const pattern of patterns) {
    const match = folded.match(pattern);
    if (!match) continue;
    return {
      folded,
      label: match[0],
      tail: line.slice(match.index + match[0].length),
    };
  }
  return null;
}

function isGenericReceiptHeader(folded) {
  return /^(?:HOA\s+DON(?:\s+(?:VAT|GIA\s+THUE\s+GIA\s+TANG))?|INVOICE(?:\s+TAX)?|BIEN\s+NHAN|RECEIPT|TAX\s+INVOICE|PHIEU)(?:\s+.*)?$/u.test(
    folded,
  );
}

function isMerchantNoise(line) {
  const trimmed = line.trim();
  const folded = foldText(trimmed);
  if (!trimmed || trimmed.length < 2) return true;
  if (/^[^A-Za-zÀ-ỹ0-9]+$/u.test(trimmed)) return true;
  if (/^[=\-_.*•|~]+$/u.test(trimmed)) return true;
  if (isGenericReceiptHeader(folded)) return true;
  if (
    /\b(?:DIA\s+CHI|DC|ADDRESS|SO\s+NHA|PHUONG|QUAN|TP|CITY|EMAIL|WEB|WEBSITE|HOTLINE|PHONE|SODT|TEL|FAX|MST|MA\s+SO\s+THUE|SO\s+LUONG|SL|QTY)\b/u.test(
      folded,
    )
  ) {
    return true;
  }
  if (/\b(?:NGAY|DATE|ISSUED)\b/u.test(folded)) return true;
  if (/\b(?:TONG|TOTAL|THANH\s+TOAN|TAM\s+TINH|SUB\s*TOTAL|VAT|GTGT)\b/u.test(folded)) {
    return true;
  }
  if (/\b(?:SO\s+(?:HOA\s+DON|HD)|HOA\s+DON\s+SO|INVOICE|RECEIPT)\b/u.test(folded)) {
    return true;
  }
  if (/\b(?:PHUONG\s+THUC|PAYMENT(?:\s+METHOD)?)\b/u.test(folded)) return true;
  if (/@|www\./iu.test(trimmed)) return true;
  if (/^\d[\d\s().-]{5,}$/u.test(trimmed)) return true;
  if (/^\d/u.test(trimmed)) return true;
  if (findAmountTokens(trimmed).length > 0) return true;
  return false;
}

function extractMerchantDetails(lines) {
  for (const line of lines) {
    const classification = classifyMerchantLine(line);
    if (!classification) continue;
    const value = cleanMerchantValue(classification.tail);
    if (!value || isGenericReceiptHeader(foldText(value))) continue;
    return { value, confidence: 0.93, source: classification.label };
  }

  for (const line of lines.slice(0, 18)) {
    if (isMerchantNoise(line)) continue;
    const value = cleanMerchantValue(line);
    if (!value) continue;
    return { value, confidence: 0.72, source: "header" };
  }

  return { value: null, confidence: 0, source: null };
}

/**
 * Extract the merchant name from a receipt header or an explicit merchant
 * label.
 *
 * @param {string|string[]} text
 * @returns {string|null}
 */
export function extractMerchant(text) {
  return extractMerchantDetails(linesFrom(text)).value;
}

function invoiceCapturePattern() {
  const label =
    "(?:SO\\s+(?:HOA\\s+DON|HD|PHIEU)|MA\\s+(?:SO\\s+)?(?:HOA\\s+DON|HD)|HOA\\s+DON(?:\\s+(?:SO|GTGT|VAT))?|INVOICE(?:\\s*(?:NO|NUMBER)\\.?)?|RECEIPT(?:\\s*(?:NO|NUMBER)\\.?)?|ORDER(?:\\s*(?:NO|NUMBER)\\.?)?|BILL(?:\\s*(?:NO|NUMBER)\\.?)?)";
  return new RegExp(
    `\\b${label}(?:\\s*#)?\\s*[:#-]?\\s*([A-Z0-9][A-Z0-9._/-]*)`,
    "iu",
  );
}

function cleanInvoiceNumber(value) {
  return value.replace(/[.,;:_/-]+$/u, "").trim();
}

function originalMatchCapture(line, match) {
  const captureLength = match[1].length;
  const end = match.index + match[0].length;
  return line.slice(end - captureLength, end);
}

function extractInvoiceDetails(lines) {
  const specificPattern = invoiceCapturePattern();
  const genericPatterns = [
    /\bSO\b\s*[:#-]\s*([A-Z0-9][A-Z0-9._/-]*)/iu,
    /\bNO\.?\b\s*[:#-]\s*([A-Z0-9][A-Z0-9._/-]*)/iu,
    /\bHD\b\s*[:#-]\s*([A-Z0-9][A-Z0-9._/-]*)/iu,
  ];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const folded = foldText(line);
    const specific = folded.match(specificPattern);
    if (specific) {
      const captured = specific[1]
        ? cleanInvoiceNumber(originalMatchCapture(line, specific))
        : "";
      if (/\d/u.test(captured)) {
        return { value: captured, confidence: 0.97, source: "invoice" };
      }

      const nextLine = lines[lineIndex + 1];
      if (nextLine) {
        const next = cleanInvoiceNumber(nextLine.trim());
        const looksLikeInvoice =
          /^[A-Za-z][A-Za-z0-9._/-]*$/u.test(next) ||
          /^\d{5,}$/u.test(next);
        if (
          next.length <= 40 &&
          /\d/u.test(next) &&
          looksLikeInvoice
        ) {
          return { value: next, confidence: 0.9, source: "invoice" };
        }
      }
    }

    for (const pattern of genericPatterns) {
      const generic = folded.match(pattern);
      if (!generic) continue;
      const captured = cleanInvoiceNumber(originalMatchCapture(line, generic));
      if (!/\d/u.test(captured)) continue;
      return { value: captured, confidence: 0.8, source: "number" };
    }
  }

  return { value: null, confidence: 0, source: null };
}

/**
 * Extract an invoice or receipt number while preserving leading zeroes.
 *
 * @param {string|string[]} text
 * @returns {string|null}
 */
export function extractInvoiceNumber(text) {
  return extractInvoiceDetails(linesFrom(text)).value;
}

function paymentLabelMatch(line) {
  const folded = foldText(line);
  const patterns = [
    /\bPHUONG\s+THUC\s+THANH\s+TOAN\b/u,
    /\bHINH\s+THUC\s+THANH\s+TOAN\b/u,
    /\bPAYMENT\s+METHOD\b/u,
    /\bPHUONG\s+THUC\b/u,
    /\bPAYMENT\b/u,
    /\bTHANH\s+TOAN\b/u,
    /\bMETHOD\b/u,
  ];

  for (const pattern of patterns) {
    const match = folded.match(pattern);
    if (match) {
      return {
        folded,
        label: match[0],
        tail: line.slice(match.index + match[0].length),
      };
    }
  }
  return null;
}

function findPaymentMethod(value) {
  for (const pattern of PAYMENT_METHOD_PATTERNS) {
    const match = value.match(pattern);
    if (match) return collapseWhitespace(match[0]);
  }
  return null;
}

function extractPaymentDetails(lines) {
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const classification = paymentLabelMatch(line);
    if (!classification) continue;

    let tail = classification.tail.replace(/^\s*[:#=-]\s*/u, "").trim();
    if (!tail && lines[lineIndex + 1]) tail = lines[lineIndex + 1].trim();
    if (!tail) continue;

    const knownMethod = findPaymentMethod(tail);
    const numericTail = tail
      .replace(/\b(?:VND|VNĐ|USD|EUR|GBP|JPY|CNY|DONG)\b/giu, "")
      .replace(/[₫$€£¥]/gu, "")
      .trim();
    if (!knownMethod && bestAmount(tail) && /^[\s\d.,+\-()]+$/u.test(numericTail)) {
      continue;
    }

    const value = knownMethod ?? cleanMerchantValue(tail);
    if (!value || value.length > 100) continue;
    return { value, confidence: 0.96, source: classification.label };
  }

  for (const line of lines) {
    if (classifyTotalLine(line)) continue;
    const value = findPaymentMethod(line);
    if (value) return { value, confidence: 0.82, source: "method" };
  }

  return { value: null, confidence: 0, source: null };
}

/**
 * Extract the payment method from Vietnamese or English receipt text.
 *
 * @param {string|string[]} text
 * @returns {string|null}
 */
export function extractPaymentMethod(text) {
  return extractPaymentDetails(linesFrom(text)).value;
}

function categoryDetails(text, merchant = null) {
  const lines = linesFrom(text);
  const merchantText = merchant ?? "";
  const fullText = lines.join(" ");
  const scores = new Map();

  for (const rule of CATEGORY_RULES) {
    let score = 0;
    for (const pattern of rule.patterns) {
      const merchantMatches = merchantText.match(new RegExp(pattern.source, pattern.flags));
      const textMatches = fullText.match(new RegExp(pattern.source, pattern.flags));
      score += (merchantMatches?.length ?? 0) * 3;
      score += textMatches?.length ?? 0;
    }
    if (score > 0) scores.set(rule.category, score);
  }

  if (scores.size === 0) {
    return { value: "other", confidence: 0.2, source: null };
  }

  const ranked = [...scores.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return CATEGORY_RULES.findIndex((rule) => rule.category === left[0]) -
      CATEGORY_RULES.findIndex((rule) => rule.category === right[0]);
  });
  const [category, score] = ranked[0];
  const hasMerchantMatch = merchantText
    ? CATEGORY_RULES.find((rule) => rule.category === category).patterns.some((pattern) =>
        pattern.test(merchantText),
      )
    : false;

  return {
    value: category,
    confidence: hasMerchantMatch ? Math.min(0.9, 0.78 + score * 0.01) : Math.min(0.78, 0.62 + score * 0.01),
    source: "heuristic",
  };
}

/**
 * Guess a stable expense category from merchant and receipt text.
 *
 * @param {string|string[]} text
 * @param {string|null} [merchant]
 * @returns {string}
 */
export function extractCategory(text, merchant = null) {
  return categoryDetails(text, merchant).value;
}

/**
 * Alias for callers that prefer a verb-style category helper.
 *
 * @param {string|string[]} text
 * @param {string|null} [merchant]
 * @returns {string}
 */
export function categorizeReceipt(text, merchant = null) {
  return extractCategory(text, merchant);
}

function roundedConfidence(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Parse Vietnamese/English receipt OCR text into a normalized ledger record.
 *
 * The returned shape is:
 * {
 *   merchant, date, total, vat, invoiceNumber, paymentMethod, category,
 *   confidence: { merchant, date, total, vat, invoiceNumber, paymentMethod,
 *                 category },
 *   lines, rawText
 * }
 *
 * Missing optional fields are null. `category` is always one of the stable
 * heuristic keys (or `other`), and dates use ISO `YYYY-MM-DD` format.
 *
 * @param {string|string[]} text
 * @returns {{
 *   merchant: string|null,
 *   date: string|null,
 *   total: number|null,
 *   vat: number|null,
 *   invoiceNumber: string|null,
 *   paymentMethod: string|null,
 *   category: string,
 *   confidence: Record<string, number>,
 *   lines: string[],
 *   rawText: string
 * }}
 */
export function parseReceipt(text) {
  const rawText = Array.isArray(text) ? text.join("\n") : asText(text);
  const lines = normalizeLines(rawText);
  const merchant = extractMerchantDetails(lines);
  const date = extractDateDetails(lines);
  const total = extractTotalDetails(lines);
  const vat = extractVatDetails(lines);
  const invoiceNumber = extractInvoiceDetails(lines);
  const paymentMethod = extractPaymentDetails(lines);
  const category = categoryDetails(lines.join("\n"), merchant.value);

  return {
    merchant: merchant.value,
    date: date.value,
    total: total.value,
    vat: vat.value,
    invoiceNumber: invoiceNumber.value,
    paymentMethod: paymentMethod.value,
    category: category.value,
    confidence: {
      merchant: roundedConfidence(merchant.confidence),
      date: roundedConfidence(date.confidence),
      total: roundedConfidence(total.confidence),
      vat: roundedConfidence(vat.confidence),
      invoiceNumber: roundedConfidence(invoiceNumber.confidence),
      paymentMethod: roundedConfidence(paymentMethod.confidence),
      category: roundedConfidence(category.confidence),
    },
    lines,
    rawText,
  };
}
