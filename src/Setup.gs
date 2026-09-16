function needsSetup_() {
  try {
    if (!getSpreadsheetId_()) return true;
    var users = readAllRecords_(APP_CONFIG.SHEETS.Users.name);
    var ready = users.some(function (user) {
      return asBoolean_(user.isActive) && String(user.passwordHash || '').indexOf('v2:') === 0;
    });
    return !ready;
  } catch (error) {
    return true;
  }
}

function initializeWorkspace_() {
  var properties = getScriptProperties_();
  var spreadsheet;
  var id = getSpreadsheetId_();
  if (id) {
    spreadsheet = SpreadsheetApp.openById(id);
  } else {
    spreadsheet = SpreadsheetApp.create('Lamai Tourism ERP Data');
    spreadsheet.setSpreadsheetTimeZone(APP_CONFIG.TIMEZONE);
    properties.setProperty('SPREADSHEET_ID', spreadsheet.getId());
  }

  Object.keys(APP_CONFIG.SHEETS).forEach(function (key) {
    ensureSheetSchema_(spreadsheet, APP_CONFIG.SHEETS[key]);
  });

  var defaultSheet = spreadsheet.getSheetByName('Sheet1');
  if (defaultSheet && spreadsheet.getSheets().length > 1) {
    spreadsheet.deleteSheet(defaultSheet);
  }

  seedSettings_();
  seedReferences_();
  migrateEnquiryStages_();
  return spreadsheet;
}

function seedSettings_() {
  var existing = {};
  readAllRecords_(APP_CONFIG.SHEETS.Settings.name).forEach(function (row) {
    existing[row.key] = true;
  });
  Object.keys(APP_CONFIG.COMPANY_DEFAULTS).forEach(function (key) {
    if (!existing[key]) {
      upsertRecord_(APP_CONFIG.SHEETS.Settings, {
        key: key,
        value: APP_CONFIG.COMPANY_DEFAULTS[key],
        updatedAt: nowIso_()
      });
    }
  });
}

function seedReferences_() {
  var existing = readAllRecords_(APP_CONFIG.SHEETS.ReferenceData.name);
  if (existing.length) return;
  APP_CONFIG.DESTINATIONS.forEach(function (label, i) {
    upsertRecord_(APP_CONFIG.SHEETS.ReferenceData, {
      itemId: 'REF-D' + (i + 1),
      kind: 'destination',
      label: label,
      isActive: true,
      sortOrder: i + 1
    });
  });
  APP_CONFIG.STYLES.forEach(function (label, i) {
    upsertRecord_(APP_CONFIG.SHEETS.ReferenceData, {
      itemId: 'REF-S' + (i + 1),
      kind: 'style',
      label: label,
      isActive: true,
      sortOrder: i + 1
    });
  });
}

function readSettingsMap_() {
  var cached = cacheGetJson_('cfg:settings');
  if (cached) return cached;
  var settings = {};
  readAllRecords_(APP_CONFIG.SHEETS.Settings.name).forEach(function (row) {
    if (row.key) settings[row.key] = row.value;
  });
  cachePutJson_('cfg:settings', settings, 300);
  return settings;
}

function groupedReferences_() {
  var cached = cacheGetJson_('cfg:references');
  if (cached) return cached;
  var destinations = [];
  var styles = [];
  readAllRecords_(APP_CONFIG.SHEETS.ReferenceData.name).forEach(function (item) {
    item.isActive = asBoolean_(item.isActive);
    if (item.kind === 'destination') destinations.push(item);
    if (item.kind === 'style') styles.push(item);
  });
  var result = { destinations: destinations, styles: styles };
  cachePutJson_('cfg:references', result, 300);
  return result;
}

function ensureHarryWorkspace_() {
  if (!getSpreadsheetId_()) return;
  if (cacheGetJson_('cfg:schemaOk')) return;
  initializeWorkspace_();
  cachePutJson_('cfg:schemaOk', { ok: true }, 600);
}
