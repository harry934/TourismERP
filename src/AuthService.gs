function createSession_(user) {
  var token = randomHex_(32);
  var payload = {
    token: token,
    userId: user.userId,
    staffUid: user.staffUid,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    workLabel: user.workLabel,
    mustChangePassword: asBoolean_(user.mustChangePassword),
    sessionEpoch: String(user.sessionEpoch || '1')
  };
  CacheService.getScriptCache().put('sess:' + token, JSON.stringify(payload), APP_CONFIG.SESSION_SECONDS);
  return payload;
}

function getSession_(token) {
  if (!normalizeText_(token)) return null;
  var raw = CacheService.getScriptCache().get('sess:' + token);
  if (!raw) return null;
  var session = JSON.parse(raw);
  var user = findRecord_(APP_CONFIG.SHEETS.Users.name, 'userId', session.userId);
  if (!user || !asBoolean_(user.isActive)) return null;
  if (String(user.sessionEpoch || '1') !== String(session.sessionEpoch || '1')) return null;
  session.mustChangePassword = asBoolean_(user.mustChangePassword);
  session.displayName = user.displayName;
  session.role = user.role;
  session.workLabel = user.workLabel;
  return session;
}

function requireSession_(token) {
  var session = getSession_(token);
  if (!session) fail_('UNAUTHENTICATED', 'Please sign in again.');
  if (session.mustChangePassword) fail_('PASSWORD_CHANGE_REQUIRED', 'Change your password to continue.');
  return session;
}

function requireAdmin_(session) {
  if (session.role !== APP_CONFIG.ROLES.SUPER_ADMIN) {
    fail_('FORBIDDEN', 'Only Super Admin can do that.');
  }
  return session;
}

function countDueFollowUps_() {
  var today = todayIso_();
  var count = 0;
  readAllRecords_(APP_CONFIG.SHEETS.Enquiries.name).forEach(function (enquiry) {
    if (asBoolean_(enquiry.archived)) return;
    if (!isLiveStage_(enquiry.stage)) return;
    var due = dateValue_(enquiry.nextFollowUpAt);
    if (due && due <= today) count += 1;
  });
  return count;
}

function getDueCountCached_() {
  var cached = cacheGetJson_('cfg:dueCount');
  if (cached && typeof cached.count === 'number') return cached.count;
  var count = countDueFollowUps_();
  cachePutJson_('cfg:dueCount', { count: count }, 120);
  return count;
}

function bumpDueCountCache_() {
  cacheRemove_('cfg:dueCount');
}

function getBootstrap(payload, session) {
  var forceSchema = !!(payload && payload.forceSchema);
  if (forceSchema || !cacheGetJson_('cfg:schemaOk')) {
    ensureHarryWorkspace_();
  }
  if (needsSetup_()) {
    return { needsSetup: true, session: null };
  }
  if (!session) {
    return { needsSetup: false, session: null };
  }
  var staff = readAllRecords_(APP_CONFIG.SHEETS.Users.name)
    .filter(function (user) { return asBoolean_(user.isActive); })
    .map(publicUser_);
  var publicSession = publicUser_(session);
  return {
    needsSetup: false,
    session: publicSession,
    permissions: buildPermissionsPayload_(session),
    staff: staff,
    settings: readSettingsMap_(),
    references: groupedReferences_(),
    dueCount: getDueCountCached_(),
    today: todayIso_()
  };
}

function setupSuperAdmin(payload) {
  return withLock_(function () {
    if (!needsSetup_()) fail_('ALREADY_SETUP', 'The workspace already has a Super Admin.');
    initializeWorkspace_();
    cachePutJson_('cfg:schemaOk', { ok: true }, 600);
    var displayName = requireString_(payload.displayName, 'Name', { maxLength: 80 });
    var username = requireString_(payload.username, 'Username', { maxLength: 40 }).toLowerCase();
    var password = String(payload.password || '');
    if (password.length < 8) fail_('INVALID_INPUT', 'Password must be at least 8 characters.');
    var user = {
      userId: 'USR-0001',
      staffUid: 'LAM-0001',
      username: username,
      displayName: displayName,
      email: '',
      passwordHash: hashPassword_(password),
      role: APP_CONFIG.ROLES.SUPER_ADMIN,
      workLabel: 'Operations',
      isActive: true,
      mustChangePassword: false,
      sessionEpoch: '1',
      createdAt: nowIso_(),
      updatedAt: nowIso_(),
      createdBy: 'setup'
    };
    upsertRecord_(APP_CONFIG.SHEETS.Users, user);
    recordAudit_(user.userId, 'SETUP', 'System', user.userId, 'Created Super Admin and workspace.');
    var session = createSession_(user);
    return {
      token: session.token,
      session: publicUser_(session)
    };
  });
}

function login(payload) {
  ensureHarryWorkspace_();
  if (needsSetup_()) fail_('NOT_INITIALIZED', 'Create the Super Admin first.');
  var username = requireString_(payload.username, 'Username', { maxLength: 40 }).toLowerCase();
  var password = String(payload.password || '');
  var user = findRecord_(APP_CONFIG.SHEETS.Users.name, 'username', username);
  if (!user || !asBoolean_(user.isActive) || !verifyPassword_(password, user.passwordHash)) {
    fail_('INVALID_LOGIN', 'Username or password is not correct.');
  }
  var session = createSession_(user);
  return {
    token: session.token,
    session: publicUser_(session)
  };
}

function logout(payload, session) {
  if (payload && payload.token) {
    CacheService.getScriptCache().remove('sess:' + payload.token);
  }
  return { ok: true };
}

function changePassword(payload, session) {
  if (!session) fail_('UNAUTHENTICATED', 'Please sign in again.');
  var currentPassword = String(payload.currentPassword || '');
  var newPassword = String(payload.newPassword || '');
  if (newPassword.length < 8) fail_('INVALID_INPUT', 'Password must be at least 8 characters.');
  var user = findRecord_(APP_CONFIG.SHEETS.Users.name, 'userId', session.userId);
  if (!user || !verifyPassword_(currentPassword, user.passwordHash)) {
    fail_('INVALID_LOGIN', 'Current password is not correct.');
  }
  user.passwordHash = hashPassword_(newPassword);
  user.mustChangePassword = false;
  user.sessionEpoch = String(Number(user.sessionEpoch || '1') + 1);
  user.updatedAt = nowIso_();
  upsertRecord_(APP_CONFIG.SHEETS.Users, user);
  var next = createSession_(user);
  return { token: next.token, session: publicUser_(next) };
}
