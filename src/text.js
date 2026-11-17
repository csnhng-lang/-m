/**
 * Làm sạch văn bản và định dạng thời gian — bản Node.js tương đương `models.py`.
 *
 * Mọi dữ liệu từ Discord/store đều phải đi qua `sanitizeText` trước khi vào embed,
 * vì tên người dùng có thể chứa markdown, `@everyone` hoặc ký tự vô hình để giả mạo.
 */

export const MAX_HANDLE_LEN = 64;
export const MAX_LABEL_LEN = 64;
export const MAX_NOTE_LEN = 500;
export const MAX_DISPLAY_NAME_LEN = 64;
export const MAX_ACCOUNT_TYPE_LEN = 32;
export const MAX_URL_LEN = 300;

const ACCOUNT_TYPE_RE = /^[a-z0-9][a-z0-9_.-]*$/;
const URL_RE = /^https?:\/\/[^\s<>"']+$/;
const MD_SPECIALS = new Set([...'\\*_~|`>[]()<@#&']);

// Ký tự vô hình/điều khiển. Giữ U+200D (ZWJ) và U+FE0F để không phá emoji.
const INVISIBLE_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]/g;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Bỏ ký tự điều khiển/vô hình, đổi U+2028/U+2029 thành xuống dòng. */
export function stripInvisible(value) {
  return String(value ?? '')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(INVISIBLE_RE, '');
}

/** Escape markdown để nội dung người dùng nhập hiển thị nguyên văn. */
export function escapeMarkdown(value) {
  let out = '';
  for (const ch of String(value ?? '')) {
    out += MD_SPECIALS.has(ch) ? `\\${ch}` : ch;
  }
  return out;
}

/**
 * Chuẩn hoá văn bản người dùng: NFC, bỏ ký tự vô hình, gộp khoảng trắng,
 * escape markdown, cắt ngắn kèm "…".
 */
export function sanitizeText(
  value,
  { maxLen = 200, singleLine = true, escape = true } = {},
) {
  let text = stripInvisible(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.normalize('NFC');
  if (singleLine) {
    text = text.replace(/\s+/g, ' ');
  } else {
    text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  }
  text = text.trim();
  if (escape) text = escapeMarkdown(text);
  if (maxLen > 0 && [...text].length > maxLen) {
    text = `${[...text].slice(0, maxLen - 1).join('').trimEnd()}…`;
  }
  return text;
}

/** Như sanitizeText nhưng dành cho văn bản bot tự soạn (không escape markdown). */
export function plainText(value, maxLen = 200) {
  return sanitizeText(value, { maxLen, singleLine: false, escape: false });
}

/**
 * Kiểm tra độ dài trên văn bản RAW rồi trả về bản đã chuẩn hoá (chưa escape).
 * Dùng khi ghi vào store: lưu raw, escape lúc render.
 */
export function cleanField(
  value,
  { name, maxLen, context = 'dulieu', required = true, singleLine = true } = {},
) {
  if (value === null || value === undefined) value = '';
  if (typeof value !== 'string') {
    throw new ValidationError(`${context}: ${name} phải là chuỗi`);
  }
  const raw = stripInvisible(value).normalize('NFC').trim();
  if (required && !raw) throw new ValidationError(`${context}: thiếu ${name}`);
  if ([...raw].length > maxLen) {
    throw new ValidationError(`${context}: ${name} dài quá ${maxLen} ký tự`);
  }
  if (required && raw.includes('\n')) {
    throw new ValidationError(`${context}: ${name} không được chứa xuống dòng`);
  }
  if (name === 'type' && !ACCOUNT_TYPE_RE.test(raw.toLowerCase())) {
    throw new ValidationError(
      `${context}: type chỉ gồm chữ thường, số và các ký tự _ . - (ví dụ: github)`,
    );
  }
  return sanitizeText(raw, { maxLen: maxLen + 16, singleLine, escape: false });
}

export function isValidUrl(value) {
  return typeof value === 'string' && value.length <= MAX_URL_LEN && URL_RE.test(value);
}

export function parseIso(value, context = '') {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new ValidationError(`${context}: thời gian phải là chuỗi ISO 8601`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`${context}: thời gian không hợp lệ (${value})`);
  }
  return date;
}

export function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Khoảng thời gian tiếng Việt: "3 năm 2 tháng", "5 ngày", "2 giờ". */
export function humanDelta(then, now = new Date()) {
  const thenDate = then instanceof Date ? then : new Date(then);
  if (Number.isNaN(thenDate.getTime())) return 'không rõ';
  const seconds = Math.floor((now.getTime() - thenDate.getTime()) / 1000);
  if (seconds < 0) return 'vừa xong';
  if (seconds < 60) return `${seconds} giây`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày`;
  if (days < 365) {
    const months = Math.floor(days / 30);
    const rem = days % 30;
    return `${months} tháng${rem ? ` ${rem} ngày` : ''}`;
  }
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  return `${years} năm${months ? ` ${months} tháng` : ''}`;
}

/** Cú pháp timestamp của Discord, tự đổi theo timezone người xem. */
export function discordTimestamp(value, style = 'f') {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'không rõ';
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

export function formatTimestampPair(value) {
  return `${discordTimestamp(value, 'f')} · ${discordTimestamp(value, 'R')}`;
}

/** Cắt ngắn văn bản kèm "…". */
export function fitText(text, limit) {
  const chars = [...String(text ?? '')];
  if (chars.length <= limit) return String(text ?? '');
  return `${chars.slice(0, Math.max(0, limit - 1)).join('').trimEnd()}…`;
}
