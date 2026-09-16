function decorateEnquiry_(enquiry, session) {
  var copy = {};
  Object.keys(enquiry).forEach(function (key) {
    copy[key] = enquiry[key];
  });
  copy.destinations = parseJson_(enquiry.destinations, []);
  copy.flexible = asBoolean_(enquiry.flexible);
  copy.adults = asNumber_(enquiry.adults, 1);
  copy.children = asNumber_(enquiry.children, 0);
  copy.budgetAmount = enquiry.budgetAmount === '' ? '' : asNumber_(enquiry.budgetAmount, '');
  copy.archived = asBoolean_(enquiry.archived);
  copy.clientName = clientName_(enquiry.clientId);
  copy.ownerName = ownerName_(enquiry.ownerId);
  copy.department = enquiry.department || departmentForStage_(enquiry.stage);
  if (session) {
    applyFieldMask_(copy, session);
  }
  return copy;
}

function applyListPaging_(items, payload) {
  var total = items.length;
  var limit = asNumber_(payload && payload.limit, 0);
  var offset = Math.max(asNumber_(payload && payload.offset, 0) || 0, 0);
  if (limit > 0) {
    limit = Math.min(limit, 500);
    items = items.slice(offset, offset + limit);
  } else {
    limit = 0;
  }
  return { items: items, total: total, limit: limit, offset: offset };
}

function listEnquiries(payload, session) {
  requireModule_(session, 'enquiries');
  var liveOnly = !!(payload && payload.liveOnly);
  var includeArchived = !!(payload && payload.includeArchived);
  var items = readAllRecords_(APP_CONFIG.SHEETS.Enquiries.name)
    .filter(function (enquiry) {
      if (includeArchived) {
        return asBoolean_(enquiry.archived) || enquiry.stage === 'Archived' || enquiry.stage === 'Closed';
      }
      if (asBoolean_(enquiry.archived)) return false;
      if (enquiry.stage === 'Archived') return false;
      if (liveOnly && !isLiveStage_(enquiry.stage)) return false;
      return true;
    });
  items = filterEnquiriesForSession_(items, session).map(function (enquiry) {
    return decorateEnquiry_(enquiry, session);
  });
  return applyListPaging_(items, payload);
}

function listArchivedEnquiries(payload, session) {
  requireModule_(session, 'archive');
  return listEnquiries({
    includeArchived: true,
    limit: payload && payload.limit,
    offset: payload && payload.offset
  }, session);
}

function getEnquiryDetail(payload, session) {
  requireModule_(session, 'enquiries');
  var enquiry = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', payload.enquiryId);
  if (!enquiry) fail_('NOT_FOUND', 'Enquiry was not found.');
  var roleId = resolveRoleId_(session);
  session._handoverIds = handoverIdsForUser_(session);
  if (!canViewRecord_(roleId, enquiry, session)) {
    fail_('FORBIDDEN', 'You do not have access to this file.');
  }
  var activities = readAllRecords_(APP_CONFIG.SHEETS.Activities.name)
    .filter(function (item) { return item.enquiryId === enquiry.enquiryId; })
    .reverse();
  var payments = readAllRecords_(APP_CONFIG.SHEETS.Payments.name)
    .filter(function (item) { return item.enquiryId === enquiry.enquiryId; })
    .map(decoratePayment_);
  payments = maskPaymentsForSession_(payments, session);
  var handovers = listHandoversForEnquiry_(enquiry.enquiryId);
  return {
    enquiry: decorateEnquiry_(enquiry, session),
    activities: activities,
    payments: payments,
    handovers: handovers
  };
}

function createEnquiry(payload, session) {
  requireAction_(session, 'createEnquiry', 'Only Sales or Admin can create a new enquiry.');
  var record = buildEnquiry_(payload, session, null);
  upsertRecord_(APP_CONFIG.SHEETS.Enquiries, record);
  bumpDueCountCache_();
  recordAudit_(session.userId, 'ENQUIRY_CREATED', 'Enquiry', record.enquiryId, record.stage);
  createActivityRecord_(session, record.enquiryId, 'stage', 'File opened at ' + record.stage, '', {
    department: record.department,
    outcome: 'Opened',
    nextAction: record.nextAction || ''
  });
  maybeGenerateMilestones_(record, session);
  return decorateEnquiry_(record, session);
}

function updateEnquiry(payload, session) {
  requireModule_(session, 'enquiries');
  var existing = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', payload.enquiryId);
  if (!existing) fail_('NOT_FOUND', 'Enquiry was not found.');
  var roleId = resolveRoleId_(session);
  session._handoverIds = handoverIdsForUser_(session);
  if (!canViewRecord_(roleId, existing, session) && roleId !== ROLE_IDS_.ADMIN) {
    fail_('FORBIDDEN', 'You do not have access to this file.');
  }
  var previousStage = existing.stage;
  var previousDept = existing.department || departmentForStage_(existing.stage);
  if (payload.stage && payload.stage !== previousStage) {
    assertStageTransition_(roleId, previousStage, payload.stage);
  }
  var record = buildEnquiry_(payload, session, existing);
  if (isTerminalStage_(record.stage) && !normalizeText_(record.lostReason)) {
    fail_('INVALID_INPUT', 'Add a reason when closing or archiving a file.');
  }
  if (record.stage === 'Archived') {
    requireAction_(session, 'archiveFile', 'Only Admin can archive a file.');
    record.archived = true;
  }
  upsertRecord_(APP_CONFIG.SHEETS.Enquiries, record);
  bumpDueCountCache_();
  if (previousStage !== record.stage) {
    createActivityRecord_(session, record.enquiryId, 'stage', 'Stage changed to ' + record.stage, '', {
      department: record.department,
      outcome: previousStage + ' → ' + record.stage,
      nextAction: record.nextAction || ''
    });
    recordAudit_(session.userId, 'STAGE_CHANGED', 'Enquiry', record.enquiryId, previousStage + ' → ' + record.stage);
  }
  var nextDept = record.department || '';
  if (previousDept !== nextDept && nextDept) {
    createHandoverRecord_({
      enquiryId: record.enquiryId,
      fromDepartment: previousDept,
      toDepartment: nextDept,
      reason: optionalString_(payload.handoverReason, 500) || ('Stage moved to ' + record.stage),
      handedBy: session.userId,
      handedTo: optionalString_(payload.handedTo, 40) || record.ownerId,
      remarks: optionalString_(payload.handoverRemarks, 500),
      ackStatus: 'Pending'
    }, session);
  }
  maybeGenerateMilestones_(record, session);
  return decorateEnquiry_(record, session);
}

function transitionEnquiry(payload, session) {
  var existing = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', payload.enquiryId);
  if (!existing) fail_('NOT_FOUND', 'Enquiry was not found.');
  var merged = {};
  Object.keys(existing).forEach(function (key) {
    merged[key] = existing[key];
  });
  merged.stage = payload.stage;
  merged.lostReason = payload.lostReason || existing.lostReason;
  merged.handoverReason = payload.handoverReason;
  merged.handedTo = payload.handedTo;
  merged.handoverRemarks = payload.handoverRemarks;
  return updateEnquiry(merged, session);
}

function buildEnquiry_(payload, session, existing) {
  if (!findRecord_(APP_CONFIG.SHEETS.Clients.name, 'clientId', payload.clientId)) {
    fail_('INVALID_INPUT', 'Select a client.');
  }
  var roleId = resolveRoleId_(session);
  var stage = normalizeStage_(optionalString_(payload.stage, 40) || (existing && existing.stage) || 'New enquiry');
  if (APP_CONFIG.STAGES.indexOf(stage) === -1) fail_('INVALID_INPUT', 'Unknown stage.');
  var record = existing || {
    enquiryId: nextPrefixedId_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', 'ENQ-'),
    createdBy: session.userId,
    createdAt: nowIso_(),
    archived: false
  };

  // Always allow client link on create; on update preserve if no sales edit
  if (!existing || canEditFieldGroup_(roleId, 'client') || roleId === ROLE_IDS_.ADMIN) {
    record.clientId = requireString_(payload.clientId, 'Client', { maxLength: 40 });
  }

  if (roleId === ROLE_IDS_.ADMIN || canEditFieldGroup_(roleId, 'ownership') || !existing) {
    if (payload.ownerId !== undefined) record.ownerId = optionalString_(payload.ownerId, 40);
    else if (!existing) record.ownerId = session.userId;
  }

  record.stage = stage;
  record.department = departmentForStage_(stage);

  if (roleId === ROLE_IDS_.ADMIN || canEditFieldGroup_(roleId, 'ownership') || !existing) {
    var priority = optionalString_(payload.priority, 20) || record.priority || 'Normal';
    if (APP_CONFIG.PRIORITIES.indexOf(priority) === -1) priority = 'Normal';
    record.priority = priority;
    var status = optionalString_(payload.status, 40) || record.status || 'Pending';
    if (APP_CONFIG.FILE_STATUSES.indexOf(status) === -1) status = 'Pending';
    record.status = status;
  }

  // Sales / client fields
  if (roleId === ROLE_IDS_.ADMIN || canEditFieldGroup_(roleId, 'salesQuote') || canEditFieldGroup_(roleId, 'client') || !existing) {
    if (payload.sourceChannel !== undefined) record.sourceChannel = optionalString_(payload.sourceChannel, 40);
    if (payload.travelStyle !== undefined) record.travelStyle = optionalString_(payload.travelStyle, 40);
    if (payload.destinations !== undefined) record.destinations = asJson_(payload.destinations, []);
    if (payload.startDate !== undefined) record.startDate = dateValue_(payload.startDate);
    if (payload.endDate !== undefined) record.endDate = dateValue_(payload.endDate);
    if (payload.flexible !== undefined) record.flexible = asBoolean_(payload.flexible);
    if (payload.flexibleMonth !== undefined) record.flexibleMonth = optionalString_(payload.flexibleMonth, 40);
    if (payload.adults !== undefined) record.adults = asNumber_(payload.adults, 1);
    if (payload.children !== undefined) record.children = asNumber_(payload.children, 0);
    if (payload.childAges !== undefined) record.childAges = optionalString_(payload.childAges, 80);
    if (payload.lodgeBand !== undefined) record.lodgeBand = optionalString_(payload.lodgeBand, 40);
    if (payload.budgetType !== undefined) record.budgetType = optionalString_(payload.budgetType, 20) || 'unknown';
    if (payload.currency !== undefined) record.currency = optionalString_(payload.currency, 8) || 'USD';
    if (payload.itineraryOutline !== undefined) record.itineraryOutline = optionalString_(payload.itineraryOutline, 4000);
    if (payload.activityNotes !== undefined) record.activityNotes = optionalString_(payload.activityNotes, 2000);
    if (payload.specialRequests !== undefined) record.specialRequests = optionalString_(payload.specialRequests, 2000);
    if (canEditFieldGroup_(roleId, 'budgetAmount') || roleId === ROLE_IDS_.ADMIN || roleId === ROLE_IDS_.SALES || !existing) {
      if (payload.budgetAmount !== undefined) {
        record.budgetAmount = payload.budgetAmount === '' || payload.budgetAmount == null ? '' : asNumber_(payload.budgetAmount, '');
      }
    }
  }

  // Supplier fields
  if (roleId === ROLE_IDS_.ADMIN || canEditFieldGroup_(roleId, 'supplier')) {
    if (payload.bookingRef !== undefined) record.bookingRef = optionalString_(payload.bookingRef, 80);
    if (payload.supplierNotes !== undefined) record.supplierNotes = optionalString_(payload.supplierNotes, 2000);
  } else if (!existing) {
    record.bookingRef = optionalString_(payload.bookingRef, 80);
    record.supplierNotes = '';
  }

  // Operations fields
  if (roleId === ROLE_IDS_.ADMIN || canEditFieldGroup_(roleId, 'operations')) {
    if (payload.operationsIssue !== undefined) record.operationsIssue = optionalString_(payload.operationsIssue, 2000);
    if (payload.tripCompletionStatus !== undefined) record.tripCompletionStatus = optionalString_(payload.tripCompletionStatus, 80);
  } else if (!existing) {
    record.operationsIssue = '';
    record.tripCompletionStatus = '';
  }

  // Follow-up / next action — any dept that can work the file
  if (payload.nextFollowUpAt !== undefined) record.nextFollowUpAt = dateValue_(payload.nextFollowUpAt);
  if (payload.nextAction !== undefined) record.nextAction = optionalString_(payload.nextAction, 200);
  if (payload.lostReason !== undefined) record.lostReason = optionalString_(payload.lostReason, 500);

  // Travel date edits by Reservations/Operations (logged via audit on update)
  if (roleId === ROLE_IDS_.RESERVATIONS || roleId === ROLE_IDS_.OPERATIONS || roleId === ROLE_IDS_.ADMIN) {
    if (payload.startDate !== undefined && !canEditFieldGroup_(roleId, 'salesQuote')) {
      record.startDate = dateValue_(payload.startDate);
    }
    if (payload.endDate !== undefined && !canEditFieldGroup_(roleId, 'salesQuote')) {
      record.endDate = dateValue_(payload.endDate);
    }
    if (payload.adults !== undefined && roleId === ROLE_IDS_.RESERVATIONS) {
      record.adults = asNumber_(payload.adults, record.adults || 1);
    }
    if (payload.children !== undefined && roleId === ROLE_IDS_.RESERVATIONS) {
      record.children = asNumber_(payload.children, record.children || 0);
    }
  }

  if (stage === 'Archived') {
    record.archived = true;
  } else if (payload.archived != null && roleId === ROLE_IDS_.ADMIN) {
    record.archived = asBoolean_(payload.archived);
  } else if (!existing) {
    record.archived = false;
  }
  record.updatedAt = nowIso_();
  return record;
}

function maybeGenerateMilestones_(enquiry, session) {
  var paymentStages = {
    'Confirmed booking': true,
    'Reservations in progress': true,
    'Supplier booking completed': true,
    'Awaiting payment': true,
    Paid: true,
    'Operations in progress': true
  };
  if (!paymentStages[enquiry.stage]) return;
  if (enquiry.budgetAmount === '' || enquiry.budgetAmount == null) return;
  try {
    generatePaymentMilestones({ enquiryId: enquiry.enquiryId }, session);
  } catch (error) {
    // Milestones already exist or amount invalid — do not block enquiry save.
  }
}

function createActivity(payload, session) {
  requireModule_(session, 'enquiries');
  var enquiryId = requireString_(payload.enquiryId, 'Enquiry', { maxLength: 40 });
  var enquiry = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', enquiryId);
  if (!enquiry) fail_('NOT_FOUND', 'Enquiry was not found.');
  var roleId = resolveRoleId_(session);
  session._handoverIds = handoverIdsForUser_(session);
  if (!canViewRecord_(roleId, enquiry, session)) {
    fail_('FORBIDDEN', 'You do not have access to this file.');
  }
  return createActivityRecord_(
    session,
    enquiryId,
    optionalString_(payload.type, 40) || 'note',
    requireString_(payload.summary, 'Summary', { maxLength: 500 }),
    dateValue_(payload.dueAt),
    {
      department: optionalString_(payload.department, 40) || departmentForRole_(roleId) || enquiry.department,
      outcome: optionalString_(payload.outcome, 200),
      nextAction: optionalString_(payload.nextAction, 200)
    }
  );
}

function createActivityRecord_(session, enquiryId, type, summary, dueAt, extras) {
  extras = extras || {};
  var enquiry = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', enquiryId);
  var department = extras.department || (enquiry && enquiry.department) || '';
  var nextAction = extras.nextAction || '';
  var record = {
    activityId: nextPrefixedId_(APP_CONFIG.SHEETS.Activities.name, 'activityId', 'ACT-'),
    enquiryId: enquiryId,
    type: type,
    summary: summary,
    department: department,
    outcome: extras.outcome || '',
    nextAction: nextAction,
    dueAt: dueAt || '',
    completedAt: '',
    createdBy: session.userId,
    createdAt: nowIso_()
  };
  upsertRecord_(APP_CONFIG.SHEETS.Activities, record);
  if (dueAt || nextAction) {
    if (enquiry) {
      if (dueAt) enquiry.nextFollowUpAt = dueAt;
      if (nextAction) enquiry.nextAction = nextAction;
      else if (dueAt) enquiry.nextAction = summary;
      enquiry.updatedAt = nowIso_();
      upsertRecord_(APP_CONFIG.SHEETS.Enquiries, enquiry);
      bumpDueCountCache_();
    }
  }
  return record;
}

function capList_(items, max) {
  if (!items || items.length <= max) return items || [];
  return items.slice(0, max);
}

function getDashboardData(payload, session) {
  requireModule_(session, 'dashboard');
  var roleId = resolveRoleId_(session);
  var widgets = dashboardWidgetsForRole_(roleId);
  var queueCap = 15;
  var tableCap = 25;
  var allLive = listEnquiries({ liveOnly: true }, session).items;
  var enquiries = allLive;
  var myFiles = enquiries.filter(function (item) {
    return item.ownerId === session.userId || !item.ownerId;
  });
  var work = getWorkData(payload, session);

  var paymentsDue = [];
  if (widgets.paymentsDue || roleId === ROLE_IDS_.ADMIN || roleId === ROLE_IDS_.ACCOUNTS) {
    paymentsDue = readAllRecords_(APP_CONFIG.SHEETS.Payments.name).filter(function (item) {
      if (item.status !== 'due') return false;
      if (roleId === ROLE_IDS_.ADMIN || roleId === ROLE_IDS_.ACCOUNTS) return true;
      var enquiry = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', item.enquiryId);
      return enquiry && canViewRecord_(roleId, enquiry, session);
    }).map(decoratePayment_);
    if (fieldPolicy_(roleId, 'payments') !== 'full') {
      paymentsDue = maskPaymentsForSession_(paymentsDue, session);
    }
  }

  var byDepartment = {};
  APP_CONFIG.DEPARTMENTS.forEach(function (dept) {
    byDepartment[dept] = 0;
  });
  var bySource = {};
  var byDestination = {};
  var estimatedRevenue = 0;
  var confirmedBookings = 0;
  var completedTrips = 0;
  var salesNew = 0;
  var salesQuoting = 0;
  var salesFollowUp = 0;
  var salesAccepted = 0;
  var resInProgress = 0;
  var resSupplierDone = 0;
  var awaitingPayment = 0;
  var paidCount = 0;
  var opsInProgress = 0;
  var upcomingTravel = 0;
  var missingBookingRef = 0;
  var today = todayIso_();

  enquiries.forEach(function (item) {
    var dept = item.department || departmentForStage_(item.stage) || 'Sales';
    if (byDepartment[dept] == null) byDepartment[dept] = 0;
    byDepartment[dept] += 1;
    if (item.stage === 'Confirmed booking' || item.stage === 'Paid' || item.stage === 'Operations in progress') {
      confirmedBookings += 1;
    }
    if (item.stage === 'Travel completed') completedTrips += 1;
    if (item.stage === 'New enquiry') salesNew += 1;
    if (item.stage === 'Quoting') salesQuoting += 1;
    if (item.stage === 'Follow-up') salesFollowUp += 1;
    if (item.stage === 'Accepted') salesAccepted += 1;
    if (item.stage === 'Reservations in progress') resInProgress += 1;
    if (item.stage === 'Supplier booking completed') resSupplierDone += 1;
    if (item.stage === 'Awaiting payment') awaitingPayment += 1;
    if (item.stage === 'Paid') paidCount += 1;
    if (item.stage === 'Operations in progress') opsInProgress += 1;
    if (item.startDate && item.startDate >= today && isLiveStage_(item.stage)) upcomingTravel += 1;
    if ((item.stage === 'Confirmed booking' || item.stage === 'Reservations in progress') && !normalizeText_(item.bookingRef)) {
      missingBookingRef += 1;
    }
    var source = item.sourceChannel || 'unknown';
    bySource[source] = (bySource[source] || 0) + 1;
    (item.destinations || []).forEach(function (dest) {
      byDestination[dest] = (byDestination[dest] || 0) + 1;
    });
    if (item.budgetAmount !== '' && item.budgetAmount != null && fieldPolicy_(roleId, 'budgetAmount') !== 'none') {
      if (fieldPolicy_(roleId, 'budgetAmount') === 'full' || fieldPolicy_(roleId, 'budgetAmount') === 'read' || roleId === ROLE_IDS_.ADMIN) {
        estimatedRevenue += asNumber_(item.budgetAmount, 0);
      }
    }
  });

  var pendingHandovers = listPendingHandovers_(session);
  var liveTable = widgets.companyFiles ? enquiries : myFiles;

  return {
    roleId: roleId,
    widgets: widgets,
    live: capList_(liveTable, tableCap),
    liveCount: enquiries.length,
    myFiles: capList_(myFiles, tableCap),
    myFilesCount: myFiles.length,
    totalEnquiries: enquiries.length,
    dueToday: capList_(work.dueToday, queueCap),
    overdue: capList_(work.overdue, queueCap),
    paymentsDue: capList_(paymentsDue, queueCap),
    byDepartment: APP_CONFIG.DEPARTMENTS.map(function (dept) {
      return { department: dept, count: byDepartment[dept] || 0 };
    }),
    confirmedBookings: confirmedBookings,
    completedTrips: completedTrips,
    salesNew: salesNew,
    salesQuoting: salesQuoting,
    salesFollowUp: salesFollowUp,
    salesAccepted: salesAccepted,
    resInProgress: resInProgress,
    resSupplierDone: resSupplierDone,
    awaitingPayment: awaitingPayment,
    paidCount: paidCount,
    opsInProgress: opsInProgress,
    upcomingTravel: upcomingTravel,
    missingBookingRef: missingBookingRef,
    pendingHandovers: capList_(pendingHandovers, queueCap),
    pendingHandoverCount: pendingHandovers.length,
    bySource: widgets.bySource ? Object.keys(bySource).map(function (key) {
      return { source: key, count: bySource[key] };
    }) : [],
    byDestination: widgets.byDestination ? Object.keys(byDestination).map(function (key) {
      return { destination: key, count: byDestination[key] };
    }) : [],
    estimatedRevenue: widgets.revenue ? estimatedRevenue : 0
  };
}

function isAdminSession_(session) {
  return session && session.role === APP_CONFIG.ROLES.SUPER_ADMIN;
}

function searchWorkspace(payload, session) {
  var query = normalizeText_(payload && payload.q).toLowerCase();
  if (query.length < 2) return { items: [] };
  var roleId = resolveRoleId_(session);
  session._handoverIds = handoverIdsForUser_(session);
  var items = [];
  if (canAccessModule_(roleId, 'clients')) {
    readAllRecords_(APP_CONFIG.SHEETS.Clients.name).forEach(function (client) {
      if (asBoolean_(client.archived)) return;
      var hay = [client.fullName, client.email, client.phoneNumber, client.nationality, client.notes].join(' ').toLowerCase();
      if (hay.indexOf(query) === -1) return;
      items.push({
        kind: 'client',
        id: client.clientId,
        title: client.fullName,
        hint: client.email || ('+' + (client.phoneCountry || '') + ' ' + (client.phoneNumber || '')),
        href: '#/clients/' + client.clientId
      });
    });
  }
  readAllRecords_(APP_CONFIG.SHEETS.Enquiries.name).forEach(function (enquiry) {
    if (!canViewRecord_(roleId, enquiry, session)) return;
    var decorated = decorateEnquiry_(enquiry, session);
    var hay = [
      decorated.clientName,
      enquiry.enquiryId,
      enquiry.stage,
      enquiry.department,
      enquiry.bookingRef,
      enquiry.nextAction,
      enquiry.itineraryOutline,
      enquiry.status
    ].join(' ').toLowerCase();
    if (hay.indexOf(query) === -1) return;
    items.push({
      kind: 'enquiry',
      id: enquiry.enquiryId,
      title: decorated.clientName || enquiry.enquiryId,
      hint: enquiry.stage + (enquiry.department ? ' · ' + enquiry.department : '') + (enquiry.nextAction ? ' · ' + enquiry.nextAction : ''),
      href: '#/enquiries/' + enquiry.enquiryId
    });
  });
  if (roleId === ROLE_IDS_.ADMIN) {
    readAllRecords_(APP_CONFIG.SHEETS.Users.name).forEach(function (user) {
      if (!asBoolean_(user.isActive)) return;
      var hay = [user.displayName, user.username, user.workLabel].join(' ').toLowerCase();
      if (hay.indexOf(query) === -1) return;
      items.push({
        kind: 'staff',
        id: user.userId,
        title: user.displayName,
        hint: user.workLabel || user.role,
        href: '#/settings'
      });
    });
  }
  return { items: items.slice(0, 20) };
}

function getNotificationData(payload, session) {
  var roleId = resolveRoleId_(session);
  var work = getWorkData(payload, session);
  var unpaid = [];
  if (roleId === ROLE_IDS_.ADMIN || roleId === ROLE_IDS_.ACCOUNTS) {
    unpaid = readAllRecords_(APP_CONFIG.SHEETS.Payments.name).filter(function (item) {
      return item.status === 'due';
    }).slice(0, 12).map(decoratePayment_);
  }
  var pendingHandovers = listPendingHandovers_(session).slice(0, 12);
  var missingConfirmations = [];
  if (roleId === ROLE_IDS_.ADMIN || roleId === ROLE_IDS_.RESERVATIONS) {
    session._handoverIds = handoverIdsForUser_(session);
    readAllRecords_(APP_CONFIG.SHEETS.Enquiries.name).forEach(function (enquiry) {
      if (asBoolean_(enquiry.archived) || !isLiveStage_(enquiry.stage)) return;
      if (!canViewRecord_(roleId, enquiry, session)) return;
      if (enquiry.stage !== 'Confirmed booking' && enquiry.stage !== 'Reservations in progress') return;
      if (normalizeText_(enquiry.bookingRef)) return;
      missingConfirmations.push({
        enquiryId: enquiry.enquiryId,
        clientName: clientName_(enquiry.clientId),
        summary: 'Supplier confirmation missing',
        stage: enquiry.stage
      });
    });
  }
  return {
    dueToday: work.dueToday || [],
    overdue: work.overdue || [],
    unpaid: unpaid,
    pendingHandovers: pendingHandovers,
    missingConfirmations: missingConfirmations.slice(0, 12)
  };
}

function getWorkData(payload, session) {
  requireModule_(session, 'work');
  var roleId = resolveRoleId_(session);
  session._handoverIds = handoverIdsForUser_(session);
  var today = todayIso_();
  var dueToday = [];
  var overdue = [];
  readAllRecords_(APP_CONFIG.SHEETS.Enquiries.name).forEach(function (enquiry) {
    if (asBoolean_(enquiry.archived) || !isLiveStage_(enquiry.stage)) return;
    if (!canViewRecord_(roleId, enquiry, session)) return;
    var due = dateValue_(enquiry.nextFollowUpAt);
    if (!due) return;
    var item = {
      enquiryId: enquiry.enquiryId,
      clientName: clientName_(enquiry.clientId),
      summary: enquiry.nextAction,
      nextAction: enquiry.nextAction,
      dueAt: due,
      nextFollowUpAt: due,
      department: enquiry.department || departmentForStage_(enquiry.stage)
    };
    if (due === today) dueToday.push(item);
    else if (due < today) overdue.push(item);
  });
  return { dueToday: dueToday, overdue: overdue };
}
