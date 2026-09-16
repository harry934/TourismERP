function listClients(payload, session) {
  var query = normalizeText_(payload && payload.q).toLowerCase();
  var items = readAllRecords_(APP_CONFIG.SHEETS.Clients.name).filter(function (client) {
    if (asBoolean_(client.archived)) return false;
    if (!query) return true;
    return [client.fullName, client.email, client.phoneNumber, client.nationality].join(' ').toLowerCase().indexOf(query) !== -1;
  });
  return { items: items };
}

function getClientDetail(payload, session) {
  var client = findRecord_(APP_CONFIG.SHEETS.Clients.name, 'clientId', payload.clientId);
  if (!client) fail_('NOT_FOUND', 'Client was not found.');
  return { client: client };
}

function createClient(payload, session) {
  requireAction_(session, 'createClient', 'You cannot create clients.');
  var record = buildClient_(payload, session, null);
  upsertRecord_(APP_CONFIG.SHEETS.Clients, record);
  recordAudit_(session.userId, 'CLIENT_CREATED', 'Client', record.clientId, record.fullName);
  return record;
}

function updateClient(payload, session) {
  requireAction_(session, 'updateClient', 'Only Sales or Admin can edit guest details.');
  var existing = findRecord_(APP_CONFIG.SHEETS.Clients.name, 'clientId', payload.clientId);
  if (!existing) fail_('NOT_FOUND', 'Client was not found.');
  var record = buildClient_(payload, session, existing);
  upsertRecord_(APP_CONFIG.SHEETS.Clients, record);
  recordAudit_(session.userId, 'CLIENT_UPDATED', 'Client', record.clientId, record.fullName);
  return record;
}

function deleteClient(payload, session) {
  requireAdmin_(session);
  return withLock_(function () {
    var clientId = requireString_(payload.clientId, 'Client', { maxLength: 40 });
    var confirmName = requireString_(payload.confirmName, 'Name', { maxLength: 120 });
    var client = findRecord_(APP_CONFIG.SHEETS.Clients.name, 'clientId', clientId);
    if (!client) fail_('NOT_FOUND', 'Client was not found.');
    if (normalizeText_(client.fullName).toLowerCase() !== normalizeText_(confirmName).toLowerCase()) {
      fail_('INVALID_INPUT', 'Type the guest name exactly to delete.');
    }
    var enquiryIds = {};
    var count = 0;
    readAllRecords_(APP_CONFIG.SHEETS.Enquiries.name).forEach(function (enquiry) {
      if (normalizeText_(enquiry.clientId) !== normalizeText_(clientId)) return;
      enquiryIds[normalizeText_(enquiry.enquiryId).toLowerCase()] = true;
      count += 1;
    });
    if (count) {
      deleteRecordsInSet_(APP_CONFIG.SHEETS.Activities, 'enquiryId', enquiryIds);
      deleteRecordsInSet_(APP_CONFIG.SHEETS.Payments, 'enquiryId', enquiryIds);
      if (APP_CONFIG.SHEETS.Handovers) {
        deleteRecordsInSet_(APP_CONFIG.SHEETS.Handovers, 'enquiryId', enquiryIds);
      }
      deleteRecordsWhere_(APP_CONFIG.SHEETS.Enquiries, 'clientId', clientId);
    }
    deleteRecord_(APP_CONFIG.SHEETS.Clients, clientId);
    recordAudit_(session.userId, 'CLIENT_DELETED', 'Client', clientId, client.fullName + ' (' + count + ' files)');
    return { ok: true, deletedEnquiries: count };
  });
}

function buildClient_(payload, session, existing) {
  var fullName = requireString_(payload.fullName, 'Full name', { maxLength: 120 });
  var record = existing || {
    clientId: nextPrefixedId_(APP_CONFIG.SHEETS.Clients.name, 'clientId', 'CLT-'),
    createdBy: session.userId,
    createdAt: nowIso_(),
    archived: false
  };
  record.fullName = fullName;
  record.email = optionalString_(payload.email, 120);
  record.phoneCountry = optionalString_(payload.phoneCountry, 8) || '255';
  record.phoneNumber = optionalString_(payload.phoneNumber, 20);
  record.nationality = optionalString_(payload.nationality, 80);
  record.partyType = optionalString_(payload.partyType, 40);
  record.languageNotes = optionalString_(payload.languageNotes, 200);
  record.source = optionalString_(payload.source, 80);
  record.notes = optionalString_(payload.notes, 2000);
  record.updatedAt = nowIso_();
  return record;
}

function clientName_(clientId) {
  var client = findRecord_(APP_CONFIG.SHEETS.Clients.name, 'clientId', clientId);
  return client ? client.fullName : '';
}

function ownerName_(ownerId) {
  if (!ownerId) return '';
  var user = findRecord_(APP_CONFIG.SHEETS.Users.name, 'userId', ownerId);
  return user ? user.displayName : '';
}
