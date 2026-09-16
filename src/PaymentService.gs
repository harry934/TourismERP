function decoratePayment_(payment) {
  var copy = {};
  Object.keys(payment).forEach(function (key) {
    copy[key] = payment[key];
  });
  var enquiry = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', payment.enquiryId);
  copy.clientName = enquiry ? clientName_(enquiry.clientId) : '';
  copy.amount = asNumber_(payment.amount, 0);
  return copy;
}

function listPayments(payload, session) {
  requireAction_(session, 'listPayments', 'Only Accounts or Admin can open the payments list.');
  var roleId = resolveRoleId_(session);
  session._handoverIds = handoverIdsForUser_(session);
  var items = readAllRecords_(APP_CONFIG.SHEETS.Payments.name)
    .filter(function (item) {
      if (roleId === ROLE_IDS_.ADMIN || roleId === ROLE_IDS_.ACCOUNTS) return true;
      var enquiry = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', item.enquiryId);
      return enquiry && canViewRecord_(roleId, enquiry, session);
    })
    .map(decoratePayment_);
  items.sort(function (a, b) {
    return String(a.dueDate) < String(b.dueDate) ? -1 : 1;
  });
  return { items: items };
}

function generatePaymentMilestones(payload, session) {
  requireAction_(session, 'generateMilestones', 'You cannot create payment milestones.');
  var enquiry = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', payload.enquiryId);
  if (!enquiry) fail_('NOT_FOUND', 'Enquiry was not found.');
  var amount = asNumber_(enquiry.budgetAmount, 0);
  if (!amount) fail_('INVALID_INPUT', 'Add a quoted amount before creating deposit and balance.');
  var existing = readAllRecords_(APP_CONFIG.SHEETS.Payments.name).filter(function (item) {
    return item.enquiryId === enquiry.enquiryId;
  });
  if (existing.length) return { items: existing.map(decoratePayment_) };
  var deposit = Math.round(amount * 50) / 100;
  var balance = Math.round((amount - deposit) * 100) / 100;
  var start = dateValue_(enquiry.startDate) || todayIso_();
  var balanceDue = addDays_(start, -90);
  if (balanceDue < todayIso_()) balanceDue = todayIso_();
  var records = [
    {
      paymentId: nextPrefixedId_(APP_CONFIG.SHEETS.Payments.name, 'paymentId', 'PAY-'),
      enquiryId: enquiry.enquiryId,
      kind: 'deposit',
      amount: deposit,
      currency: enquiry.currency || 'USD',
      dueDate: todayIso_(),
      status: 'due',
      receivedAt: '',
      note: '50% deposit per Lamai T&Cs',
      createdAt: nowIso_(),
      updatedAt: nowIso_()
    },
    {
      paymentId: '',
      enquiryId: enquiry.enquiryId,
      kind: 'balance',
      amount: balance,
      currency: enquiry.currency || 'USD',
      dueDate: balanceDue,
      status: 'due',
      receivedAt: '',
      note: 'Balance due 90 days before departure',
      createdAt: nowIso_(),
      updatedAt: nowIso_()
    }
  ];
  upsertRecord_(APP_CONFIG.SHEETS.Payments, records[0]);
  records[1].paymentId = nextPrefixedId_(APP_CONFIG.SHEETS.Payments.name, 'paymentId', 'PAY-');
  upsertRecord_(APP_CONFIG.SHEETS.Payments, records[1]);
  recordAudit_(session.userId, 'MILESTONES_CREATED', 'Enquiry', enquiry.enquiryId, 'Deposit and balance created');
  return { items: records.map(decoratePayment_) };
}

function markPaymentPaid(payload, session) {
  requireAction_(session, 'markPaymentPaid', 'You can view this record, but only Accounts can update payment details.');
  var payment = findRecord_(APP_CONFIG.SHEETS.Payments.name, 'paymentId', payload.paymentId);
  if (!payment) fail_('NOT_FOUND', 'Payment was not found.');
  payment.status = 'received';
  payment.receivedAt = todayIso_();
  payment.note = optionalString_(payload.note, 200) || payment.note;
  payment.updatedAt = nowIso_();
  upsertRecord_(APP_CONFIG.SHEETS.Payments, payment);

  var enquiry = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', payment.enquiryId);
  if (enquiry) {
    var previousStage = enquiry.stage;
    var previousDept = enquiry.department || departmentForStage_(enquiry.stage);
    var siblings = readAllRecords_(APP_CONFIG.SHEETS.Payments.name).filter(function (item) {
      return item.enquiryId === enquiry.enquiryId;
    });
    var allReceived = siblings.every(function (item) {
      var status = item.paymentId === payment.paymentId ? 'received' : item.status;
      return status === 'received' || status === 'waived';
    });

    if (allReceived) {
      enquiry.stage = 'Paid';
      enquiry.status = 'Paid';
    } else if (payment.kind === 'deposit') {
      var earlyStages = {
        'New enquiry': true,
        Quoting: true,
        'Follow-up': true,
        Accepted: true,
        'Confirmed booking': true,
        'Reservations in progress': true,
        'Supplier booking completed': true,
        'Awaiting payment': true
      };
      if (earlyStages[enquiry.stage] || enquiry.stage === 'Awaiting payment') {
        if (enquiry.stage === 'New enquiry' || enquiry.stage === 'Quoting' || enquiry.stage === 'Follow-up' || enquiry.stage === 'Accepted') {
          enquiry.stage = 'Confirmed booking';
        } else if (enquiry.stage === 'Awaiting payment' || enquiry.stage === 'Supplier booking completed') {
          enquiry.stage = 'Awaiting payment';
        }
        enquiry.status = 'Confirmed';
      }
    }

    enquiry.department = departmentForStage_(enquiry.stage);
    enquiry.updatedAt = nowIso_();
    upsertRecord_(APP_CONFIG.SHEETS.Enquiries, enquiry);

    if (previousStage !== enquiry.stage) {
      createActivityRecord_(session, enquiry.enquiryId, 'stage', 'Stage changed to ' + enquiry.stage, '', {
        department: enquiry.department,
        outcome: 'Payment received',
        nextAction: enquiry.nextAction || ''
      });
      recordAudit_(session.userId, 'STAGE_CHANGED', 'Enquiry', enquiry.enquiryId, previousStage + ' → ' + enquiry.stage);
      if (previousDept !== enquiry.department && enquiry.department) {
        createHandoverRecord_({
          enquiryId: enquiry.enquiryId,
          fromDepartment: previousDept,
          toDepartment: enquiry.department,
          reason: 'Payment marked received (' + payment.kind + ')',
          handedBy: session.userId,
          handedTo: enquiry.ownerId,
          remarks: '',
          ackStatus: 'Pending'
        }, session);
      }
    }
  }

  recordAudit_(session.userId, 'PAYMENT_RECEIVED', 'Payment', payment.paymentId, payment.kind);
  return decoratePayment_(payment);
}

function updatePayment(payload, session) {
  requireAction_(session, 'editFinanceFields', 'You can view this record, but only Accounts can update payment details.');
  var payment = findRecord_(APP_CONFIG.SHEETS.Payments.name, 'paymentId', payload.paymentId);
  if (!payment) fail_('NOT_FOUND', 'Payment was not found.');
  if (payload.amount != null && payload.amount !== '') payment.amount = asNumber_(payload.amount, payment.amount);
  if (payload.status) payment.status = payload.status;
  if (payload.note != null) payment.note = optionalString_(payload.note, 200);
  payment.updatedAt = nowIso_();
  upsertRecord_(APP_CONFIG.SHEETS.Payments, payment);
  return decoratePayment_(payment);
}
