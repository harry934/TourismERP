function getAdminData(payload, session) {
  requireAdmin_(session);
  return {
    staff: readAllRecords_(APP_CONFIG.SHEETS.Users.name).map(publicUser_),
    settings: readSettingsMap_(),
    references: groupedReferences_()
  };
}

function createUser(payload, session) {
  requireAdmin_(session);
  return withLock_(function () {
    var displayName = requireString_(payload.displayName, 'Name', { maxLength: 80 });
    var workLabel = optionalString_(payload.workLabel, 40);
    if (workLabel && APP_CONFIG.WORK_LABELS.indexOf(workLabel) === -1) {
      fail_('INVALID_INPUT', 'Unknown work label.');
    }
    var base = slugUsername_(displayName);
    var username = base;
    var suffix = 1;
    while (findRecord_(APP_CONFIG.SHEETS.Users.name, 'username', username)) {
      suffix += 1;
      username = base + suffix;
    }
    var password = oneTimePassword_();
    var user = {
      userId: nextPrefixedId_(APP_CONFIG.SHEETS.Users.name, 'userId', 'USR-'),
      staffUid: nextPrefixedId_(APP_CONFIG.SHEETS.Users.name, 'staffUid', 'LAM-'),
      username: username,
      displayName: displayName,
      email: optionalString_(payload.email, 120),
      passwordHash: hashPassword_(password),
      role: APP_CONFIG.ROLES.STAFF,
      workLabel: workLabel || 'Sales',
      isActive: true,
      mustChangePassword: true,
      sessionEpoch: '1',
      createdAt: nowIso_(),
      updatedAt: nowIso_(),
      createdBy: session.userId
    };
    upsertRecord_(APP_CONFIG.SHEETS.Users, user);
    recordAudit_(session.userId, 'STAFF_CREATED', 'User', user.userId, username);
    return {
      user: publicUser_(user),
      username: username,
      oneTimePassword: password
    };
  });
}

function updateUser(payload, session) {
  requireAdmin_(session);
  var user = findRecord_(APP_CONFIG.SHEETS.Users.name, 'userId', payload.userId);
  if (!user) fail_('NOT_FOUND', 'Staff member was not found.');
  if (payload.displayName) user.displayName = requireString_(payload.displayName, 'Name', { maxLength: 80 });
  if (payload.workLabel) user.workLabel = optionalString_(payload.workLabel, 40);
  if (payload.isActive != null) user.isActive = asBoolean_(payload.isActive);
  user.updatedAt = nowIso_();
  upsertRecord_(APP_CONFIG.SHEETS.Users, user);
  return publicUser_(user);
}

function deactivateUser(payload, session) {
  requireAdmin_(session);
  var user = findRecord_(APP_CONFIG.SHEETS.Users.name, 'userId', payload.userId);
  if (!user) fail_('NOT_FOUND', 'Staff member was not found.');
  if (user.role === APP_CONFIG.ROLES.SUPER_ADMIN) fail_('FORBIDDEN', 'The Super Admin account cannot be removed.');
  var restore = asBoolean_(payload.restore);
  user.isActive = restore;
  if (!restore) user.sessionEpoch = String(Number(user.sessionEpoch || '1') + 1);
  user.updatedAt = nowIso_();
  upsertRecord_(APP_CONFIG.SHEETS.Users, user);
  recordAudit_(session.userId, restore ? 'STAFF_RESTORED' : 'STAFF_DEACTIVATED', 'User', user.userId, user.username);
  return publicUser_(user);
}

function deleteUser(payload, session) {
  requireAdmin_(session);
  return withLock_(function () {
    var userId = requireString_(payload.userId, 'Staff', { maxLength: 40 });
    var confirmUsername = requireString_(payload.confirmUsername, 'Username', { maxLength: 40 }).toLowerCase();
    var user = findRecord_(APP_CONFIG.SHEETS.Users.name, 'userId', userId);
    if (!user) fail_('NOT_FOUND', 'Staff member was not found.');
    if (user.role === APP_CONFIG.ROLES.SUPER_ADMIN) fail_('FORBIDDEN', 'The Super Admin account cannot be deleted.');
    if (user.userId === session.userId) fail_('FORBIDDEN', 'You cannot delete your own account.');
    if (normalizeText_(user.username).toLowerCase() !== confirmUsername) {
      fail_('INVALID_INPUT', 'Type the username exactly to delete.');
    }
    readAllRecords_(APP_CONFIG.SHEETS.Enquiries.name).forEach(function (enquiry) {
      if (normalizeText_(enquiry.ownerId) !== normalizeText_(userId)) return;
      enquiry.ownerId = '';
      enquiry.updatedAt = nowIso_();
      upsertRecord_(APP_CONFIG.SHEETS.Enquiries, enquiry);
    });
    deleteRecord_(APP_CONFIG.SHEETS.Users, userId);
    recordAudit_(session.userId, 'STAFF_DELETED', 'User', userId, user.username);
    return { ok: true };
  });
}

function resetStaffPassword(payload, session) {
  requireAdmin_(session);
  var user = findRecord_(APP_CONFIG.SHEETS.Users.name, 'userId', payload.userId);
  if (!user) fail_('NOT_FOUND', 'Staff member was not found.');
  if (user.role === APP_CONFIG.ROLES.SUPER_ADMIN) fail_('FORBIDDEN', 'Reset the Super Admin password from Change password.');
  var password = oneTimePassword_();
  user.passwordHash = hashPassword_(password);
  user.mustChangePassword = true;
  user.sessionEpoch = String(Number(user.sessionEpoch || '1') + 1);
  user.updatedAt = nowIso_();
  upsertRecord_(APP_CONFIG.SHEETS.Users, user);
  return { oneTimePassword: password, username: user.username };
}

function updateSettings(payload, session) {
  requireAdmin_(session);
  var settings = payload.settings || {};
  Object.keys(settings).forEach(function (key) {
    if (/password|token|secret|spreadsheet/i.test(key)) return;
    upsertRecord_(APP_CONFIG.SHEETS.Settings, {
      key: key,
      value: optionalString_(settings[key], 300),
      updatedAt: nowIso_()
    });
  });
  return { settings: readSettingsMap_() };
}

function saveReferenceItem(payload, session) {
  requireAdmin_(session);
  var kind = requireString_(payload.kind, 'Kind', { maxLength: 40 });
  if (kind !== 'destination' && kind !== 'style') fail_('INVALID_INPUT', 'Kind must be destination or style.');
  var label = requireString_(payload.label, 'Label', { maxLength: 80 });
  var record = payload.itemId
    ? findRecord_(APP_CONFIG.SHEETS.ReferenceData.name, 'itemId', payload.itemId)
    : null;
  if (!record) {
    record = {
      itemId: nextPrefixedId_(APP_CONFIG.SHEETS.ReferenceData.name, 'itemId', 'REF-'),
      kind: kind,
      sortOrder: readAllRecords_(APP_CONFIG.SHEETS.ReferenceData.name).length + 1
    };
  }
  record.kind = kind;
  record.label = label;
  record.isActive = payload.isActive == null ? true : asBoolean_(payload.isActive);
  upsertRecord_(APP_CONFIG.SHEETS.ReferenceData, record);
  return groupedReferences_();
}
