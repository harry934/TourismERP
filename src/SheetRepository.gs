var _requestSheetCache_ = {};
var _requestSpreadsheet_ = null;

function clearRequestCaches_() {
  _requestSheetCache_ = {};
  _requestSpreadsheet_ = null;
}

function invalidateSheetCache_(sheetName) {
  if (sheetName) {
    delete _requestSheetCache_[sheetName];
    delete _requestSheetCache_['hdr:' + sheetName];
  } else {
    _requestSheetCache_ = {};
  }
}

function getScriptProperties_() {
  return PropertiesService.getScriptProperties();
}

function getSpreadsheetId_() {
  return normalizeText_(getScriptProperties_().getProperty('SPREADSHEET_ID'));
}

function getSpreadsheet_() {
  if (_requestSpreadsheet_) return _requestSpreadsheet_;
  var id = getSpreadsheetId_();
  if (!id) fail_('NOT_INITIALIZED', 'The workspace is not set up yet.');
  _requestSpreadsheet_ = SpreadsheetApp.openById(id);
  return _requestSpreadsheet_;
}

function getHeaderContext_(sheetName) {
  var cacheKey = 'hdr:' + sheetName;
  if (_requestSheetCache_[cacheKey]) return _requestSheetCache_[cacheKey];
  var spreadsheet = getSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) fail_('MISSING_SHEET', 'Missing sheet: ' + sheetName);
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(function (value) {
    return normalizeText_(value);
  });
  var index = {};
  headers.forEach(function (header, i) {
    if (header) index[header] = i;
  });
  var context = { sheet: sheet, headers: headers, index: index };
  _requestSheetCache_[cacheKey] = context;
  return context;
}

function ensureSheetSchema_(spreadsheet, schema) {
  var sheet = spreadsheet.getSheetByName(schema.name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(schema.name);
  }
  var existing = sheet.getLastColumn() > 0
    ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0]
    : [];
  var have = {};
  existing.forEach(function (header) {
    have[normalizeText_(header)] = true;
  });
  var missing = schema.columns.filter(function (column) {
    return !have[column];
  });
  if (!existing.length || !normalizeText_(existing[0])) {
    sheet.getRange(1, 1, 1, schema.columns.length).setValues([schema.columns]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  if (missing.length) {
    sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  sheet.setFrozenRows(1);
  return sheet;
}

function rowToRecord_(headers, row) {
  var record = {};
  headers.forEach(function (header, i) {
    if (header) record[header] = row[i];
  });
  return record;
}

function recordToRow_(headers, record) {
  return headers.map(function (header) {
    return record[header] == null ? '' : record[header];
  });
}

function readAllRecords_(sheetName) {
  if (_requestSheetCache_[sheetName]) return _requestSheetCache_[sheetName];
  var context = getHeaderContext_(sheetName);
  var lastRow = context.sheet.getLastRow();
  if (lastRow < 2) {
    _requestSheetCache_[sheetName] = [];
    return _requestSheetCache_[sheetName];
  }
  var values = context.sheet.getRange(2, 1, lastRow, context.headers.length).getDisplayValues();
  var records = values.map(function (row) {
    return rowToRecord_(context.headers, row);
  }).filter(function (record) {
    return normalizeText_(record[Object.keys(record)[0]]);
  });
  _requestSheetCache_[sheetName] = records;
  return records;
}

function findRecord_(sheetName, field, value) {
  var needle = normalizeText_(value).toLowerCase();
  var records = readAllRecords_(sheetName);
  var i;
  for (i = 0; i < records.length; i++) {
    if (normalizeText_(records[i][field]).toLowerCase() === needle) return records[i];
  }
  return null;
}

function nextPrefixedId_(sheetName, field, prefix) {
  var max = 0;
  readAllRecords_(sheetName).forEach(function (record) {
    var match = String(record[field] || '').match(/(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  });
  var next = String(max + 1);
  while (next.length < 4) next = '0' + next;
  return prefix + next;
}

function upsertRecord_(schema, record) {
  invalidateSheetCache_(schema.name);
  var context = getHeaderContext_(schema.name);
  var key = schema.primaryKey;
  var id = normalizeText_(record[key]);
  var lastRow = context.sheet.getLastRow();
  if (lastRow >= 2) {
    var keys = context.sheet.getRange(2, (context.index[key] || 0) + 1, lastRow, 1).getDisplayValues();
    var i;
    for (i = 0; i < keys.length; i++) {
      if (normalizeText_(keys[i][0]) === id) {
        var existingRow = context.sheet.getRange(i + 2, 1, 1, context.headers.length).getDisplayValues()[0];
        var merged = rowToRecord_(context.headers, existingRow);
        Object.keys(record).forEach(function (field) {
          merged[field] = record[field];
        });
        context.sheet.getRange(i + 2, 1, 1, context.headers.length).setValues([recordToRow_(context.headers, merged)]);
        invalidateSheetCache_(schema.name);
        return merged;
      }
    }
  }
  context.sheet.appendRow(recordToRow_(context.headers, record));
  invalidateSheetCache_(schema.name);
  return record;
}

function recordAudit_(actorUserId, action, entityType, entityId, summary) {
  upsertRecord_(APP_CONFIG.SHEETS.AuditLog, {
    auditId: 'AUD-' + randomHex_(8),
    actorUserId: actorUserId || '',
    action: action,
    entityType: entityType,
    entityId: entityId || '',
    summary: summary || '',
    createdAt: nowIso_()
  });
}

function clearSheetRows_(schema) {
  invalidateSheetCache_(schema.name);
  var spreadsheet = getSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(schema.name);
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow, lastColumn).clearContent();
  }
}

function deleteRecordsWhere_(schema, field, value) {
  var set = {};
  set[normalizeText_(value).toLowerCase()] = true;
  return deleteRecordsInSet_(schema, field, set);
}

function deleteRecordsInSet_(schema, field, idSet) {
  invalidateSheetCache_(schema.name);
  var context = getHeaderContext_(schema.name);
  var colIndex = context.index[field];
  if (colIndex == null) return 0;
  var lastRow = context.sheet.getLastRow();
  if (lastRow < 2) return 0;
  var values = context.sheet.getRange(2, colIndex + 1, lastRow, 1).getDisplayValues();
  var deleted = 0;
  var i;
  var key;
  for (i = values.length - 1; i >= 0; i--) {
    key = normalizeText_(values[i][0]).toLowerCase();
    if (idSet[key]) {
      context.sheet.deleteRow(i + 2);
      deleted += 1;
    }
  }
  invalidateSheetCache_(schema.name);
  return deleted;
}

function deleteRecord_(schema, id) {
  return deleteRecordsWhere_(schema, schema.primaryKey, id);
}

function cacheGetJson_(key) {
  try {
    var raw = CacheService.getScriptCache().get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function cachePutJson_(key, value, seconds) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), seconds || 300);
  } catch (error) {
    // Cache quota exceeded — ignore.
  }
}

function cacheRemove_(key) {
  try {
    CacheService.getScriptCache().remove(key);
  } catch (error) {
    // ignore
  }
}

function invalidateConfigCaches_() {
  cacheRemove_('cfg:settings');
  cacheRemove_('cfg:references');
  cacheRemove_('cfg:dueCount');
}
