var ROLE_IDS_ = {
  ADMIN: 'ADMIN',
  SALES: 'SALES',
  RESERVATIONS: 'RESERVATIONS',
  ACCOUNTS: 'ACCOUNTS',
  OPERATIONS: 'OPERATIONS'
};

var ROLE_DEPARTMENT_ = {
  ADMIN: '',
  SALES: 'Sales',
  RESERVATIONS: 'Reservations',
  ACCOUNTS: 'Accounts',
  OPERATIONS: 'Operations'
};

var ROLE_STAGES_ = {
  SALES: ['New enquiry', 'Quoting', 'Follow-up', 'Accepted'],
  RESERVATIONS: ['Confirmed booking', 'Reservations in progress', 'Supplier booking completed'],
  ACCOUNTS: ['Awaiting payment', 'Paid'],
  OPERATIONS: ['Operations in progress', 'Travel completed']
};

var MODULE_ACCESS_ = {
  ADMIN: {
    dashboard: true, enquiries: true, clients: true, pipeline: true, work: true,
    handovers: true, payments: true, reports: true, archive: true, settings: true
  },
  SALES: {
    dashboard: true, enquiries: true, clients: true, pipeline: true, work: true,
    handovers: true, payments: false, reports: true, archive: true, settings: false
  },
  RESERVATIONS: {
    dashboard: true, enquiries: true, clients: true, pipeline: true, work: true,
    handovers: true, payments: false, reports: true, archive: true, settings: false
  },
  ACCOUNTS: {
    dashboard: true, enquiries: true, clients: true, pipeline: true, work: true,
    handovers: true, payments: true, reports: true, archive: true, settings: false
  },
  OPERATIONS: {
    dashboard: true, enquiries: true, clients: true, pipeline: true, work: true,
    handovers: true, payments: false, reports: true, archive: true, settings: false
  }
};

// Field groups: full | read | summary | none
var FIELD_POLICY_ = {
  ADMIN: {
    client: 'full', salesQuote: 'full', supplier: 'full', finance: 'full',
    operations: 'full', ownership: 'full', budgetAmount: 'full', payments: 'full'
  },
  SALES: {
    client: 'full', salesQuote: 'full', supplier: 'read', finance: 'summary',
    operations: 'read', ownership: 'full', budgetAmount: 'full', payments: 'summary'
  },
  RESERVATIONS: {
    client: 'read', salesQuote: 'read', supplier: 'full', finance: 'summary',
    operations: 'read', ownership: 'full', budgetAmount: 'read', payments: 'summary'
  },
  ACCOUNTS: {
    client: 'read', salesQuote: 'read', supplier: 'read', finance: 'full',
    operations: 'read', ownership: 'full', budgetAmount: 'read', payments: 'full'
  },
  OPERATIONS: {
    client: 'read', salesQuote: 'read', supplier: 'read', finance: 'summary',
    operations: 'full', ownership: 'full', budgetAmount: 'summary', payments: 'summary'
  }
};

var ACTION_ROLES_ = {
  createEnquiry: ['ADMIN', 'SALES'],
  editSalesFields: ['ADMIN', 'SALES'],
  editSupplierFields: ['ADMIN', 'RESERVATIONS'],
  editFinanceFields: ['ADMIN', 'ACCOUNTS'],
  editOperationsFields: ['ADMIN', 'OPERATIONS'],
  markPaymentPaid: ['ADMIN', 'ACCOUNTS'],
  generateMilestones: ['ADMIN', 'ACCOUNTS', 'SALES'],
  createHandover: ['ADMIN', 'SALES', 'RESERVATIONS', 'ACCOUNTS', 'OPERATIONS'],
  acknowledgeHandover: ['ADMIN', 'SALES', 'RESERVATIONS', 'ACCOUNTS', 'OPERATIONS'],
  archiveFile: ['ADMIN'],
  reopenArchived: ['ADMIN'],
  manageUsers: ['ADMIN'],
  manageSettings: ['ADMIN'],
  runReports: ['ADMIN', 'SALES', 'RESERVATIONS', 'ACCOUNTS', 'OPERATIONS'],
  listPayments: ['ADMIN', 'ACCOUNTS'],
  deleteClient: ['ADMIN'],
  createClient: ['ADMIN', 'SALES', 'RESERVATIONS', 'ACCOUNTS', 'OPERATIONS'],
  updateClient: ['ADMIN', 'SALES']
};

function resolveRoleId_(session) {
  if (!session) return '';
  if (session.role === APP_CONFIG.ROLES.SUPER_ADMIN) return ROLE_IDS_.ADMIN;
  var label = normalizeText_(session.workLabel);
  if (label === 'Sales') return ROLE_IDS_.SALES;
  if (label === 'Reservations') return ROLE_IDS_.RESERVATIONS;
  if (label === 'Accounts') return ROLE_IDS_.ACCOUNTS;
  if (label === 'Operations' || label === 'Guide') return ROLE_IDS_.OPERATIONS;
  return ROLE_IDS_.SALES;
}

function departmentForRole_(roleId) {
  return ROLE_DEPARTMENT_[roleId] || '';
}

function canAccessModule_(roleId, moduleName) {
  var map = MODULE_ACCESS_[roleId];
  if (!map) return false;
  return !!map[moduleName];
}

function requireModule_(session, moduleName) {
  var roleId = resolveRoleId_(session);
  if (!canAccessModule_(roleId, moduleName)) {
    fail_('FORBIDDEN', 'You do not have access to this area.');
  }
  return roleId;
}

function canPerformAction_(roleId, action) {
  var allowed = ACTION_ROLES_[action];
  if (!allowed) return false;
  return allowed.indexOf(roleId) !== -1;
}

function requireAction_(session, action, message) {
  var roleId = resolveRoleId_(session);
  if (!canPerformAction_(roleId, action)) {
    fail_('FORBIDDEN', message || 'You do not have permission to do that.');
  }
  return roleId;
}

function fieldPolicy_(roleId, fieldGroup) {
  var map = FIELD_POLICY_[roleId] || FIELD_POLICY_.SALES;
  return map[fieldGroup] || 'none';
}

function canEditFieldGroup_(roleId, fieldGroup) {
  return fieldPolicy_(roleId, fieldGroup) === 'full';
}

function stagesForRole_(roleId) {
  if (roleId === ROLE_IDS_.ADMIN) return APP_CONFIG.STAGES.slice();
  return (ROLE_STAGES_[roleId] || []).slice();
}

function assertStageTransition_(roleId, fromStage, toStage) {
  if (roleId === ROLE_IDS_.ADMIN) return;
  if (fromStage === toStage) return;
  var allowed = stagesForRole_(roleId);
  var terminal = isTerminalStage_(toStage);
  if (terminal && roleId !== ROLE_IDS_.ADMIN && roleId !== ROLE_IDS_.OPERATIONS) {
    fail_('FORBIDDEN', 'Only Operations or Admin can close or archive a file.');
  }
  if (terminal && roleId === ROLE_IDS_.OPERATIONS && toStage === 'Archived') {
    fail_('FORBIDDEN', 'Only Admin can archive a file. You can mark it Closed.');
  }
  var fromDept = departmentForStage_(fromStage);
  var toDept = departmentForStage_(toStage);
  if (toDept && allowed.indexOf(toStage) === -1 && fromDept !== toDept) {
    fail_('FORBIDDEN', 'That stage belongs to another department. Use a handover, or ask Admin to override.');
  }
  if (toDept && allowed.indexOf(toStage) === -1 && !terminal) {
    fail_('FORBIDDEN', 'Your role cannot move a file to "' + toStage + '".');
  }
}

function handoverIdsForUser_(session) {
  var ids = {};
  if (!session || !session.userId) return ids;
  readAllRecords_(APP_CONFIG.SHEETS.Handovers.name).forEach(function (item) {
    if (item.handedTo === session.userId || item.handedBy === session.userId) {
      ids[item.enquiryId] = true;
    }
  });
  return ids;
}

function canViewRecord_(roleId, enquiry, session) {
  if (!enquiry) return false;
  if (roleId === ROLE_IDS_.ADMIN) return true;
  if (enquiry.ownerId && enquiry.ownerId === session.userId) return true;
  var dept = enquiry.department || departmentForStage_(enquiry.stage);
  var myDept = departmentForRole_(roleId);
  if (myDept && dept === myDept) return true;
  if (!enquiry.ownerId && myDept && dept === myDept) return true;
  var handoverIds = session._handoverIds || handoverIdsForUser_(session);
  if (handoverIds[enquiry.enquiryId]) return true;
  // Cross-department continuity: sales stages visible as summary context for all who can see module
  return false;
}

function filterEnquiriesForSession_(items, session) {
  var roleId = resolveRoleId_(session);
  if (roleId === ROLE_IDS_.ADMIN) return items;
  session._handoverIds = handoverIdsForUser_(session);
  return items.filter(function (enquiry) {
    return canViewRecord_(roleId, enquiry, session);
  });
}

function buildPermissionsPayload_(session) {
  var roleId = resolveRoleId_(session);
  var modules = MODULE_ACCESS_[roleId] || MODULE_ACCESS_.SALES;
  return {
    roleId: roleId,
    department: departmentForRole_(roleId),
    modules: modules,
    stages: stagesForRole_(roleId),
    fields: FIELD_POLICY_[roleId] || FIELD_POLICY_.SALES,
    actions: {
      createEnquiry: canPerformAction_(roleId, 'createEnquiry'),
      editSalesFields: canPerformAction_(roleId, 'editSalesFields'),
      editSupplierFields: canPerformAction_(roleId, 'editSupplierFields'),
      editFinanceFields: canPerformAction_(roleId, 'editFinanceFields'),
      editOperationsFields: canPerformAction_(roleId, 'editOperationsFields'),
      markPaymentPaid: canPerformAction_(roleId, 'markPaymentPaid'),
      createHandover: canPerformAction_(roleId, 'createHandover'),
      archiveFile: canPerformAction_(roleId, 'archiveFile'),
      manageSettings: canPerformAction_(roleId, 'manageSettings'),
      listPayments: canPerformAction_(roleId, 'listPayments'),
      runReports: canPerformAction_(roleId, 'runReports')
    }
  };
}

function applyFieldMask_(enquiry, session) {
  var roleId = resolveRoleId_(session);
  var fields = FIELD_POLICY_[roleId] || FIELD_POLICY_.SALES;
  var access = {
    client: fields.client,
    salesQuote: fields.salesQuote,
    supplier: fields.supplier,
    finance: fields.finance,
    operations: fields.operations,
    ownership: fields.ownership,
    budgetAmount: fields.budgetAmount,
    payments: fields.payments
  };
  enquiry._access = access;
  enquiry._canEdit = {
    sales: canEditFieldGroup_(roleId, 'salesQuote') || canEditFieldGroup_(roleId, 'client'),
    supplier: canEditFieldGroup_(roleId, 'supplier'),
    finance: canEditFieldGroup_(roleId, 'finance'),
    operations: canEditFieldGroup_(roleId, 'operations'),
    ownership: roleId === ROLE_IDS_.ADMIN || enquiry.ownerId === session.userId || !enquiry.ownerId
  };
  if (fields.budgetAmount === 'none') {
    enquiry.budgetAmount = '';
  } else if (fields.budgetAmount === 'summary' && enquiry.budgetAmount !== '' && enquiry.budgetAmount != null) {
    enquiry.budgetAmountSummary = 'Set';
  }
  return enquiry;
}

function maskPaymentsForSession_(payments, session) {
  var roleId = resolveRoleId_(session);
  var policy = fieldPolicy_(roleId, 'payments');
  if (policy === 'full') return payments;
  if (policy === 'none') return [];
  // summary: status/kind/due only — strip amount detail
  return (payments || []).map(function (payment) {
    return {
      paymentId: payment.paymentId,
      enquiryId: payment.enquiryId,
      kind: payment.kind,
      status: payment.status,
      dueDate: payment.dueDate,
      currency: payment.currency,
      amount: '',
      amountHidden: true,
      clientName: payment.clientName || '',
      note: ''
    };
  });
}

function dashboardWidgetsForRole_(roleId) {
  var all = {
    myFiles: true,
    companyFiles: false,
    salesPipeline: false,
    reservations: false,
    accounts: false,
    operations: false,
    handovers: true,
    revenue: false,
    bySource: false,
    byDestination: false,
    overdue: true,
    paymentsDue: false
  };
  if (roleId === ROLE_IDS_.ADMIN) {
    return {
      myFiles: true, companyFiles: true, salesPipeline: true, reservations: true,
      accounts: true, operations: true, handovers: true, revenue: true,
      bySource: true, byDestination: true, overdue: true, paymentsDue: true
    };
  }
  if (roleId === ROLE_IDS_.SALES) {
    return Object.assign({}, all, {
      salesPipeline: true, revenue: true, bySource: true, byDestination: true
    });
  }
  if (roleId === ROLE_IDS_.RESERVATIONS) {
    return Object.assign({}, all, {
      reservations: true, byDestination: true
    });
  }
  if (roleId === ROLE_IDS_.ACCOUNTS) {
    return Object.assign({}, all, {
      accounts: true, revenue: true, paymentsDue: true, byDestination: true
    });
  }
  if (roleId === ROLE_IDS_.OPERATIONS) {
    return Object.assign({}, all, {
      operations: true, byDestination: true
    });
  }
  return all;
}
