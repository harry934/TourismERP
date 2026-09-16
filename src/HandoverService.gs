function decorateHandover_(handover) {
  var copy = {};
  Object.keys(handover).forEach(function (key) {
    copy[key] = handover[key];
  });
  var enquiry = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', handover.enquiryId);
  copy.clientName = enquiry ? clientName_(enquiry.clientId) : '';
  copy.handedByName = ownerName_(handover.handedBy);
  copy.handedToName = ownerName_(handover.handedTo);
  return copy;
}

function listHandoversForEnquiry_(enquiryId) {
  return readAllRecords_(APP_CONFIG.SHEETS.Handovers.name)
    .filter(function (item) { return item.enquiryId === enquiryId; })
    .map(decorateHandover_)
    .reverse();
}

function listPendingHandovers_(session) {
  var roleId = resolveRoleId_(session);
  return readAllRecords_(APP_CONFIG.SHEETS.Handovers.name)
    .filter(function (item) {
      if (normalizeText_(item.ackStatus).toLowerCase() === 'acknowledged') return false;
      if (roleId === ROLE_IDS_.ADMIN) return true;
      return item.handedTo === session.userId || item.handedBy === session.userId || !item.handedTo;
    })
    .map(decorateHandover_);
}

function createHandoverRecord_(fields, session) {
  var enquiryId = requireString_(fields.enquiryId, 'Enquiry', { maxLength: 40 });
  var toDepartment = requireString_(fields.toDepartment, 'To department', { maxLength: 40 });
  if (APP_CONFIG.DEPARTMENTS.indexOf(toDepartment) === -1) {
    fail_('INVALID_INPUT', 'Unknown department.');
  }
  var fromDepartment = optionalString_(fields.fromDepartment, 40);
  var handedTo = optionalString_(fields.handedTo, 40);
  if (fields.requireRecipient && !handedTo) {
    fail_('INVALID_INPUT', 'Select who the file is handed to.');
  }
  var reason = optionalString_(fields.reason, 500) || 'Department handover';
  if (fields.requireReason && !optionalString_(fields.reason, 500)) {
    fail_('INVALID_INPUT', 'Add a reason for the handover.');
  }
  var record = {
    handoverId: nextPrefixedId_(APP_CONFIG.SHEETS.Handovers.name, 'handoverId', 'HO-'),
    enquiryId: enquiryId,
    fromDepartment: fromDepartment,
    toDepartment: toDepartment,
    handoverDate: dateValue_(fields.handoverDate) || todayIso_(),
    reason: reason,
    handedBy: optionalString_(fields.handedBy, 40) || (session && session.userId) || '',
    handedTo: handedTo,
    remarks: optionalString_(fields.remarks, 500),
    ackStatus: optionalString_(fields.ackStatus, 40) || 'Pending',
    createdAt: nowIso_()
  };
  upsertRecord_(APP_CONFIG.SHEETS.Handovers, record);
  if (session && session.userId) {
    recordAudit_(session.userId, 'HANDOVER_CREATED', 'Handover', record.handoverId, fromDepartment + ' → ' + toDepartment);
    createActivityRecord_(session, enquiryId, 'note', 'Handover ' + (fromDepartment || '—') + ' → ' + toDepartment, '', {
      department: toDepartment,
      outcome: record.reason,
      nextAction: ''
    });
  }
  return decorateHandover_(record);
}

function listHandovers(payload, session) {
  requireModule_(session, 'handovers');
  var enquiryId = optionalString_(payload && payload.enquiryId, 40);
  if (enquiryId) {
    return { items: listHandoversForEnquiry_(enquiryId) };
  }
  var pendingOnly = !!(payload && payload.pendingOnly);
  var roleId = resolveRoleId_(session);
  var items = readAllRecords_(APP_CONFIG.SHEETS.Handovers.name)
    .filter(function (item) {
      if (pendingOnly && normalizeText_(item.ackStatus).toLowerCase() === 'acknowledged') return false;
      if (roleId === ROLE_IDS_.ADMIN) return true;
      return item.handedTo === session.userId || item.handedBy === session.userId || !item.handedTo;
    })
    .map(decorateHandover_)
    .reverse();
  return { items: items };
}

function createHandover(payload, session) {
  requireAction_(session, 'createHandover', 'You cannot hand over this file.');
  var enquiry = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', payload.enquiryId);
  if (!enquiry) fail_('NOT_FOUND', 'Enquiry was not found.');
  var roleId = resolveRoleId_(session);
  session._handoverIds = handoverIdsForUser_(session);
  if (!canViewRecord_(roleId, enquiry, session) && roleId !== ROLE_IDS_.ADMIN) {
    fail_('FORBIDDEN', 'You do not have access to this file.');
  }
  var toDepartment = requireString_(payload.toDepartment, 'To department', { maxLength: 40 });
  var fromDepartment = optionalString_(payload.fromDepartment, 40) || enquiry.department || departmentForStage_(enquiry.stage);
  var handedTo = requireString_(payload.handedTo, 'Hand to', { maxLength: 40 });
  var record = createHandoverRecord_({
    enquiryId: enquiry.enquiryId,
    fromDepartment: fromDepartment,
    toDepartment: toDepartment,
    handoverDate: payload.handoverDate,
    reason: payload.reason,
    handedBy: session.userId,
    handedTo: handedTo,
    remarks: payload.remarks,
    ackStatus: 'Pending',
    requireRecipient: true,
    requireReason: true
  }, session);

  // Keep ownership with sender until acknowledged (unless Admin override sets owner)
  enquiry.department = toDepartment;
  enquiry.updatedAt = nowIso_();
  upsertRecord_(APP_CONFIG.SHEETS.Enquiries, enquiry);

  return record;
}

function acknowledgeHandover(payload, session) {
  requireAction_(session, 'acknowledgeHandover', 'You cannot acknowledge this handover.');
  var handover = findRecord_(APP_CONFIG.SHEETS.Handovers.name, 'handoverId', payload.handoverId);
  if (!handover) fail_('NOT_FOUND', 'Handover was not found.');
  var roleId = resolveRoleId_(session);
  if (roleId !== ROLE_IDS_.ADMIN && handover.handedTo && handover.handedTo !== session.userId) {
    fail_('FORBIDDEN', 'Only the assigned staff member can acknowledge this handover.');
  }
  handover.ackStatus = 'Acknowledged';
  upsertRecord_(APP_CONFIG.SHEETS.Handovers, handover);

  var enquiry = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', handover.enquiryId);
  if (enquiry) {
    if (handover.handedTo) enquiry.ownerId = handover.handedTo;
    if (handover.toDepartment) enquiry.department = handover.toDepartment;
    enquiry.updatedAt = nowIso_();
    upsertRecord_(APP_CONFIG.SHEETS.Enquiries, enquiry);
  }

  recordAudit_(session.userId, 'HANDOVER_ACKED', 'Handover', handover.handoverId, handover.enquiryId);
  return decorateHandover_(handover);
}
