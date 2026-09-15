function fail_(code, message) {
  var error = new Error(message || code);
  error.code = code;
  throw error;
}

function nowIso_() {
  return Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function todayIso_() {
  return Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function normalizeText_(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function requireString_(value, label, options) {
  var text = normalizeText_(value);
  var min = options && options.minLength ? options.minLength : 1;
  var max = options && options.maxLength ? options.maxLength : 500;
  if (text.length < min || text.length > max) {
    fail_('INVALID_INPUT', label + ' is required.');
  }
  return text;
}

function optionalString_(value, maxLength) {
  var text = normalizeText_(value);
  if (text.length > (maxLength || 2000)) {
    fail_('INVALID_INPUT', 'Text is too long.');
  }
  return text;
}

function asBoolean_(value) {
  if (value === true || value === 'true' || value === 'TRUE' || value === 1 || value === '1') return true;
  return false;
}

function asNumber_(value, fallback) {
  if (value === '' || value == null) return fallback;
  var number = Number(value);
  return isNaN(number) ? fallback : number;
}

function asJson_(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return JSON.stringify(value);
  }
  var text = normalizeText_(value);
  if (!text) return JSON.stringify(fallback || []);
  try {
    JSON.parse(text);
    return text;
  } catch (error) {
    return JSON.stringify(fallback || []);
  }
}

function parseJson_(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === 'object' && !value.getMonth)) {
    return value;
  }
  try {
    return JSON.parse(value || 'null') || fallback;
  } catch (error) {
    return fallback;
  }
}

function addDays_(isoDate, days) {
  var parts = String(isoDate || '').split('-');
  if (parts.length < 3) return todayIso_();
  var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  date.setUTCDate(date.getUTCDate() + days);
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

function dateValue_(value) {
  return String(value || '').slice(0, 10);
}

function isLiveStage_(stage) {
  return stage !== 'Completed' && stage !== 'Lost';
}

function randomHex_(size) {
  return Utilities.getUuid().replace(/-/g, '').slice(0, size || 16);
}

function sha256Hex_(text) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  var hex = '';
  var i;
  var unsigned;
  for (i = 0; i < digest.length; i++) {
    unsigned = digest[i] < 0 ? digest[i] + 256 : digest[i];
    hex += ('0' + unsigned.toString(16)).slice(-2);
  }
  return hex;
}

function hashPassword_(password) {
  var salt = randomHex_(16);
  var value = salt + String(password);
  var i;
  for (i = 0; i < APP_CONFIG.HASH_ROUNDS; i++) {
    value = sha256Hex_(value);
  }
  return 'v2:' + APP_CONFIG.HASH_ROUNDS + ':' + salt + ':' + value;
}

function verifyPassword_(password, stored) {
  var parts = String(stored || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v2') return false;
  var rounds = Number(parts[1]);
  var salt = parts[2];
  var expected = parts[3];
  var value = salt + String(password);
  var i;
  for (i = 0; i < rounds; i++) {
    value = sha256Hex_(value);
  }
  return value === expected;
}

function oneTimePassword_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  var out = '';
  var i;
  var bytes = Utilities.getUuid().replace(/-/g, '');
  for (i = 0; i < 12; i++) {
    out += chars.charAt(parseInt(bytes.charAt(i * 2), 16) % chars.length);
  }
  return out;
}

function slugUsername_(name) {
  var slug = normalizeText_(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
  return slug || 'staff';
}

function publicUser_(record) {
  return {
    userId: record.userId,
    staffUid: record.staffUid,
    username: record.username,
    displayName: record.displayName,
    role: record.role,
    workLabel: record.workLabel,
    isActive: asBoolean_(record.isActive),
    mustChangePassword: asBoolean_(record.mustChangePassword)
  };
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
