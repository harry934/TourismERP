function decorateEnquiry_(enquiry) {
  var copy = {};
  Object.keys(enquiry).forEach(function (key) {
    copy[key] = enquiry[key];
  });
  copy.destinations = parseJson_(enquiry.destinations, []);
  copy.flexible = asBoolean_(enquiry.flexible);
  copy.adults = asNumber_(enquiry.adults, 1);
  copy.children = asNumber_(enquiry.children, 0);
  copy.budgetAmount = enquiry.budgetAmount === '' ? '' : asNumber_(enquiry.budgetAmount, '');
  copy.clientName = clientName_(enquiry.clientId);
  copy.ownerName = ownerName_(enquiry.ownerId);
  return copy;
}

function listEnquiries(payload, session) {
  var liveOnly = !!(payload && payload.liveOnly);
  var items = readAllRecords_(APP_CONFIG.SHEETS.Enquiries.name)
    .filter(function (enquiry) {
      if (asBoolean_(enquiry.archived)) return false;
      if (liveOnly && !isLiveStage_(enquiry.stage)) return false;
      return true;
    })
    .map(decorateEnquiry_);
  return { items: items };
}

function getEnquiryDetail(payload, session) {
  var enquiry = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', payload.enquiryId);
  if (!enquiry) fail_('NOT_FOUND', 'Enquiry was not found.');
  var activities = readAllRecords_(APP_CONFIG.SHEETS.Activities.name)
    .filter(function (item) { return item.enquiryId === enquiry.enquiryId; })
    .reverse();
  var payments = readAllRecords_(APP_CONFIG.SHEETS.Payments.name)
    .filter(function (item) { return item.enquiryId === enquiry.enquiryId; });
  return {
    enquiry: decorateEnquiry_(enquiry),
    activities: activities,
    payments: payments
  };
}

function createEnquiry(payload, session) {
  var record = buildEnquiry_(payload, session, null);
  upsertRecord_(APP_CONFIG.SHEETS.Enquiries, record);
  recordAudit_(session.userId, 'ENQUIRY_CREATED', 'Enquiry', record.enquiryId, record.stage);
  maybeGenerateMilestones_(record, session);
  return decorateEnquiry_(record);
}

function updateEnquiry(payload, session) {
  var existing = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', payload.enquiryId);
  if (!existing) fail_('NOT_FOUND', 'Enquiry was not found.');
  var previousStage = existing.stage;
  var record = buildEnquiry_(payload, session, existing);
  if (record.stage === 'Lost' && !normalizeText_(record.lostReason)) {
    fail_('INVALID_INPUT', 'Add a reason when marking a file Lost.');
  }
  upsertRecord_(APP_CONFIG.SHEETS.Enquiries, record);
  if (previousStage !== record.stage) {
    createActivityRecord_(session, record.enquiryId, 'stage', 'Stage changed to ' + record.stage, '');
    recordAudit_(session.userId, 'STAGE_CHANGED', 'Enquiry', record.enquiryId, previousStage + ' → ' + record.stage);
  }
  maybeGenerateMilestones_(record, session);
  return decorateEnquiry_(record);
}

function transitionEnquiry(payload, session) {
  payload.enquiryId = payload.enquiryId;
  var existing = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', payload.enquiryId);
  if (!existing) fail_('NOT_FOUND', 'Enquiry was not found.');
  existing.stage = payload.stage;
  existing.lostReason = payload.lostReason || existing.lostReason;
  return updateEnquiry(existing, session);
}

function buildEnquiry_(payload, session, existing) {
  if (!findRecord_(APP_CONFIG.SHEETS.Clients.name, 'clientId', payload.clientId)) {
    fail_('INVALID_INPUT', 'Select a client.');
  }
  var stage = optionalString_(payload.stage, 40) || 'New';
  if (APP_CONFIG.STAGES.indexOf(stage) === -1) fail_('INVALID_INPUT', 'Unknown stage.');
  var record = existing || {
    enquiryId: nextPrefixedId_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', 'ENQ-'),
    createdBy: session.userId,
    createdAt: nowIso_(),
    archived: false
  };
  record.clientId = requireString_(payload.clientId, 'Client', { maxLength: 40 });
  record.ownerId = optionalString_(payload.ownerId, 40);
  record.stage = stage;
  record.sourceChannel = optionalString_(payload.sourceChannel, 40);
  record.travelStyle = optionalString_(payload.travelStyle, 40);
  record.destinations = asJson_(payload.destinations, []);
  record.startDate = dateValue_(payload.startDate);
  record.endDate = dateValue_(payload.endDate);
  record.flexible = asBoolean_(payload.flexible);
  record.flexibleMonth = optionalString_(payload.flexibleMonth, 40);
  record.adults = asNumber_(payload.adults, 1);
  record.children = asNumber_(payload.children, 0);
  record.childAges = optionalString_(payload.childAges, 80);
  record.lodgeBand = optionalString_(payload.lodgeBand, 40);
  record.budgetType = optionalString_(payload.budgetType, 20) || 'unknown';
  record.budgetAmount = payload.budgetAmount === '' || payload.budgetAmount == null ? '' : asNumber_(payload.budgetAmount, '');
  record.currency = optionalString_(payload.currency, 8) || 'USD';
  record.itineraryOutline = optionalString_(payload.itineraryOutline, 4000);
  record.activityNotes = optionalString_(payload.activityNotes, 2000);
  record.specialRequests = optionalString_(payload.specialRequests, 2000);
  record.nextFollowUpAt = dateValue_(payload.nextFollowUpAt);
  record.nextAction = optionalString_(payload.nextAction, 200);
  record.lostReason = optionalString_(payload.lostReason, 500);
  record.updatedAt = nowIso_();
  return record;
}

function maybeGenerateMilestones_(enquiry, session) {
  if (enquiry.stage !== 'Deposit due' && enquiry.stage !== 'Confirmed' && enquiry.stage !== 'Balance due') return;
  if (enquiry.budgetAmount === '' || enquiry.budgetAmount == null) return;
  generatePaymentMilestones({ enquiryId: enquiry.enquiryId }, session);
}

function createActivity(payload, session) {
  return createActivityRecord_(
    session,
    requireString_(payload.enquiryId, 'Enquiry', { maxLength: 40 }),
    optionalString_(payload.type, 40) || 'note',
    requireString_(payload.summary, 'Summary', { maxLength: 500 }),
    dateValue_(payload.dueAt)
  );
}

function createActivityRecord_(session, enquiryId, type, summary, dueAt) {
  var record = {
    activityId: nextPrefixedId_(APP_CONFIG.SHEETS.Activities.name, 'activityId', 'ACT-'),
    enquiryId: enquiryId,
    type: type,
    summary: summary,
    dueAt: dueAt || '',
    completedAt: '',
    createdBy: session.userId,
    createdAt: nowIso_()
  };
  upsertRecord_(APP_CONFIG.SHEETS.Activities, record);
  if (dueAt) {
    var enquiry = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', enquiryId);
    if (enquiry) {
      enquiry.nextFollowUpAt = dueAt;
      enquiry.nextAction = summary;
      enquiry.updatedAt = nowIso_();
      upsertRecord_(APP_CONFIG.SHEETS.Enquiries, enquiry);
    }
  }
  return record;
}

function getDashboardData(payload, session) {
  var enquiries = listEnquiries({ liveOnly: true }, session).items;
  if (!isAdminSession_(session)) {
    enquiries = enquiries.filter(function (item) {
      return !item.ownerId || item.ownerId === session.userId;
    });
  }
  var work = getWorkData(payload, session);
  var paymentsDue = readAllRecords_(APP_CONFIG.SHEETS.Payments.name).filter(function (item) {
    if (item.status !== 'due') return false;
    if (isAdminSession_(session)) return true;
    var enquiry = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', item.enquiryId);
    return enquiry && (!enquiry.ownerId || enquiry.ownerId === session.userId);
  }).map(decoratePayment_);
  return {
    live: enquiries,
    liveCount: enquiries.length,
    dueToday: work.dueToday,
    overdue: work.overdue,
    paymentsDue: paymentsDue
  };
}

function isAdminSession_(session) {
  return session && session.role === APP_CONFIG.ROLES.SUPER_ADMIN;
}

function searchWorkspace(payload, session) {
  var query = normalizeText_(payload && payload.q).toLowerCase();
  if (query.length < 2) return { items: [] };
  var items = [];
  readAllRecords_(APP_CONFIG.SHEETS.Clients.name).forEach(function (client) {
    if (asBoolean_(client.archived)) return;
    var hay = [client.fullName, client.email, client.phoneNumber, client.nationality, client.notes].join(' ').toLowerCase();
    if (hay.indexOf(query) === -1) return;
    items.push({
      kind: 'client',
      id: client.clientId,
      title: client.fullName,
      hint: client.email || ('+' + (client.phoneCountry || '') + ' ' + (client.phoneNumber || '')),
      href: '#/clients'
    });
  });
  readAllRecords_(APP_CONFIG.SHEETS.Enquiries.name).forEach(function (enquiry) {
    if (asBoolean_(enquiry.archived)) return;
    if (!isAdminSession_(session) && enquiry.ownerId && enquiry.ownerId !== session.userId) return;
    var decorated = decorateEnquiry_(enquiry);
    var hay = [decorated.clientName, enquiry.enquiryId, enquiry.stage, enquiry.nextAction, enquiry.itineraryOutline].join(' ').toLowerCase();
    if (hay.indexOf(query) === -1) return;
    items.push({
      kind: 'enquiry',
      id: enquiry.enquiryId,
      title: decorated.clientName || enquiry.enquiryId,
      hint: enquiry.stage + (enquiry.nextAction ? ' · ' + enquiry.nextAction : ''),
      href: '#/enquiries/' + enquiry.enquiryId
    });
  });
  readAllRecords_(APP_CONFIG.SHEETS.Users.name).forEach(function (user) {
    if (!asBoolean_(user.isActive)) return;
    var hay = [user.displayName, user.username, user.workLabel].join(' ').toLowerCase();
    if (hay.indexOf(query) === -1) return;
    items.push({
      kind: 'staff',
      id: user.userId,
      title: user.displayName,
      hint: user.workLabel || user.role,
      href: isAdminSession_(session) ? '#/settings' : '#/today'
    });
  });
  return { items: items.slice(0, 20) };
}

function getNotificationData(payload, session) {
  var work = getWorkData(payload, session);
  var unpaid = [];
  if (isAdminSession_(session)) {
    unpaid = readAllRecords_(APP_CONFIG.SHEETS.Payments.name).filter(function (item) {
      return item.status === 'due';
    }).slice(0, 12).map(decoratePayment_);
  }
  return {
    dueToday: work.dueToday || [],
    overdue: work.overdue || [],
    unpaid: unpaid
  };
}

function getWorkData(payload, session) {
  var today = todayIso_();
  var dueToday = [];
  var overdue = [];
  readAllRecords_(APP_CONFIG.SHEETS.Enquiries.name).forEach(function (enquiry) {
    if (asBoolean_(enquiry.archived) || !isLiveStage_(enquiry.stage)) return;
    if (!isAdminSession_(session) && enquiry.ownerId && enquiry.ownerId !== session.userId) return;
    var due = dateValue_(enquiry.nextFollowUpAt);
    if (!due) return;
    var item = {
      enquiryId: enquiry.enquiryId,
      clientName: clientName_(enquiry.clientId),
      summary: enquiry.nextAction,
      nextAction: enquiry.nextAction,
      dueAt: due,
      nextFollowUpAt: due
    };
    if (due === today) dueToday.push(item);
    else if (due < today) overdue.push(item);
  });
  return { dueToday: dueToday, overdue: overdue };
}
