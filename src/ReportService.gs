function weekdayMon0_(isoDate) {
  var parts = String(isoDate || '').slice(0, 10).split('-');
  if (parts.length < 3) return 0;
  var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  var day = date.getUTCDay();
  return day === 0 ? 6 : day - 1;
}

function lastDayOfMonth_(isoDate) {
  var parts = String(isoDate || '').slice(0, 10).split('-');
  var y = Number(parts[0]);
  var m = Number(parts[1]);
  var last = new Date(Date.UTC(y, m, 0));
  return Utilities.formatDate(last, 'UTC', 'yyyy-MM-dd');
}

function resolveReportPeriod_(payload) {
  var period = normalizeText_(payload && payload.period || 'daily').toLowerCase();
  if (period !== 'daily' && period !== 'weekly' && period !== 'monthly' && period !== 'custom') {
    fail_('INVALID_INPUT', 'Period must be daily, weekly, or monthly.');
  }
  var anchor = dateValue_(payload && payload.date) || todayIso_();
  var startDate = '';
  var endDate = '';
  if (period === 'custom') {
    startDate = dateValue_(payload.startDate) || anchor;
    endDate = dateValue_(payload.endDate) || startDate;
    if (endDate < startDate) {
      var swap = startDate;
      startDate = endDate;
      endDate = swap;
    }
  } else if (period === 'daily') {
    startDate = anchor;
    endDate = anchor;
  } else if (period === 'weekly') {
    startDate = addDays_(anchor, -weekdayMon0_(anchor));
    endDate = addDays_(startDate, 6);
  } else {
    startDate = String(anchor).slice(0, 7) + '-01';
    endDate = lastDayOfMonth_(anchor);
  }
  return {
    period: period === 'custom' ? 'custom' : period,
    anchor: anchor,
    startDate: startDate,
    endDate: endDate
  };
}

function inDateRange_(value, startDate, endDate) {
  var day = dateValue_(value);
  if (!day) return false;
  return day >= startDate && day <= endDate;
}

function enquiryInReportPeriod_(enquiry, range, forTravel) {
  if (forTravel) return inDateRange_(enquiry.startDate, range.startDate, range.endDate);
  return inDateRange_(enquiry.updatedAt, range.startDate, range.endDate)
    || inDateRange_(enquiry.createdAt, range.startDate, range.endDate)
    || inDateRange_(enquiry.startDate, range.startDate, range.endDate);
}

function resolveReportDepartment_(payload, session, roleId) {
  var locked = departmentForRole_(roleId);
  if (roleId !== ROLE_IDS_.ADMIN) {
    return locked || 'Sales';
  }
  var requested = normalizeText_(payload && payload.department || 'ALL');
  if (!requested || requested.toUpperCase() === 'ALL') return 'ALL';
  if (APP_CONFIG.DEPARTMENTS.indexOf(requested) === -1) {
    fail_('INVALID_INPUT', 'Department must be Sales, Reservations, Accounts, Operations, or ALL.');
  }
  return requested;
}

function resolveReportStaffFilter_(payload, session, roleId, department) {
  var staffId = normalizeText_(payload && payload.staffId);
  if (!staffId) return '';
  if (roleId === ROLE_IDS_.ADMIN) return staffId;
  if (staffId === session.userId) return staffId;
  var target = findRecord_(APP_CONFIG.SHEETS.Users.name, 'userId', staffId);
  if (!target || !asBoolean_(target.isActive)) {
    fail_('FORBIDDEN', 'You can only filter staff in your department.');
  }
  var targetRole = resolveRoleId_({
    role: target.role,
    workLabel: target.workLabel,
    userId: target.userId
  });
  if (departmentForRole_(targetRole) !== department) {
    fail_('FORBIDDEN', 'You can only filter staff in your department.');
  }
  return staffId;
}

function kpiItem_(key, label, value, tone) {
  return { key: key, label: label, value: value || 0, tone: tone || 'primary' };
}

function buildDepartmentKpis_(department, scoped, payments, handovers, range, roleId) {
  var today = todayIso_();
  var kpis = [];
  var exceptions = [];
  var byStageMap = {};
  APP_CONFIG.STAGES.forEach(function (stage) {
    byStageMap[stage] = 0;
  });

  var newEnquiries = 0;
  var quoting = 0;
  var followUpsDue = 0;
  var followUpsOverdue = 0;
  var accepted = 0;
  var closed = 0;
  var estimatedValue = 0;
  var confirmedReceived = 0;
  var resInProgress = 0;
  var supplierCompleted = 0;
  var missingBookingRef = 0;
  var awaitingPayment = 0;
  var paid = 0;
  var unpaidMilestones = 0;
  var paymentExceptions = 0;
  var opsInProgress = 0;
  var upcomingTravel = 0;
  var completed = 0;
  var openIssues = 0;
  var readyToClose = 0;

  scoped.forEach(function (item) {
    byStageMap[item.stage] = (byStageMap[item.stage] || 0) + 1;
    if (item.stage === 'New enquiry') newEnquiries += 1;
    if (item.stage === 'Quoting') quoting += 1;
    if (item.stage === 'Accepted') accepted += 1;
    if (item.stage === 'Closed' || item.stage === 'Archived') closed += 1;
    if (item.stage === 'Confirmed booking') confirmedReceived += 1;
    if (item.stage === 'Reservations in progress') resInProgress += 1;
    if (item.stage === 'Supplier booking completed') supplierCompleted += 1;
    if (item.stage === 'Awaiting payment') awaitingPayment += 1;
    if (item.stage === 'Paid') paid += 1;
    if (item.stage === 'Operations in progress') opsInProgress += 1;
    if (item.stage === 'Travel completed') {
      completed += 1;
      readyToClose += 1;
    }
    var due = dateValue_(item.nextFollowUpAt);
    if (due && isLiveStage_(item.stage)) {
      if (due === today) followUpsDue += 1;
      if (due < today) followUpsOverdue += 1;
    }
    if ((item.stage === 'Confirmed booking' || item.stage === 'Reservations in progress') && !normalizeText_(item.bookingRef)) {
      missingBookingRef += 1;
      exceptions.push({
        kind: 'missing_booking_ref',
        enquiryId: item.enquiryId,
        clientName: item.clientName,
        summary: 'Missing booking reference'
      });
    }
    if (item.fileStatus === 'Delayed' || item.priority === 'Urgent') {
      openIssues += 1;
      exceptions.push({
        kind: 'open_issue',
        enquiryId: item.enquiryId,
        clientName: item.clientName,
        summary: (item.fileStatus === 'Delayed' ? 'Delayed' : 'Urgent') + (item.nextAction ? ': ' + item.nextAction : '')
      });
    }
    if (item.startDate && item.startDate >= today && item.startDate <= range.endDate && isLiveStage_(item.stage)) {
      upcomingTravel += 1;
    }
    if (item.budgetAmount !== '' && item.budgetAmount != null && fieldPolicy_(roleId, 'budgetAmount') !== 'none') {
      estimatedValue += asNumber_(item.budgetAmount, 0);
    }
  });

  payments.forEach(function (pay) {
    if (pay.status === 'due') {
      unpaidMilestones += 1;
      if (dateValue_(pay.dueDate) && dateValue_(pay.dueDate) < today) {
        paymentExceptions += 1;
        exceptions.push({
          kind: 'overdue_payment',
          enquiryId: pay.enquiryId,
          clientName: pay.clientName,
          summary: (pay.kind || 'Payment') + ' overdue'
        });
      }
    }
  });

  var pendingHandovers = handovers.filter(function (item) {
    return item.ackStatus !== 'Acknowledged';
  }).length;

  if (department === 'Sales' || department === 'ALL') {
    kpis.push(kpiItem_('newEnquiries', 'New enquiries', newEnquiries));
    kpis.push(kpiItem_('quoting', 'Quoting', quoting));
    kpis.push(kpiItem_('followUpsDue', 'Follow-ups due', followUpsDue, 'warning'));
    kpis.push(kpiItem_('followUpsOverdue', 'Follow-ups overdue', followUpsOverdue, 'danger'));
    kpis.push(kpiItem_('accepted', 'Accepted', accepted, 'success'));
    kpis.push(kpiItem_('closed', 'Closed', closed));
    if (fieldPolicy_(roleId, 'budgetAmount') !== 'none') {
      kpis.push(kpiItem_('estimatedValue', 'Estimated value', estimatedValue, 'warning'));
    }
  }
  if (department === 'Reservations' || department === 'ALL') {
    kpis.push(kpiItem_('confirmedReceived', 'Confirmed received', confirmedReceived));
    kpis.push(kpiItem_('resInProgress', 'In progress', resInProgress));
    kpis.push(kpiItem_('supplierCompleted', 'Supplier completed', supplierCompleted, 'success'));
    kpis.push(kpiItem_('missingBookingRef', 'Missing booking ref', missingBookingRef, 'danger'));
    kpis.push(kpiItem_('pendingHandovers', 'Pending handovers', pendingHandovers, 'info'));
  }
  if (department === 'Accounts' || department === 'ALL') {
    kpis.push(kpiItem_('awaitingPayment', 'Awaiting payment', awaitingPayment, 'warning'));
    kpis.push(kpiItem_('paid', 'Paid', paid, 'success'));
    kpis.push(kpiItem_('unpaidMilestones', 'Unpaid milestones', unpaidMilestones, 'danger'));
    kpis.push(kpiItem_('paymentExceptions', 'Payment exceptions', paymentExceptions, 'danger'));
  }
  if (department === 'Operations' || department === 'ALL') {
    kpis.push(kpiItem_('opsInProgress', 'Ops in progress', opsInProgress));
    kpis.push(kpiItem_('upcomingTravel', 'Upcoming travel', upcomingTravel, 'info'));
    kpis.push(kpiItem_('completed', 'Completed', completed, 'success'));
    kpis.push(kpiItem_('openIssues', 'Open issues', openIssues, 'danger'));
    kpis.push(kpiItem_('readyToClose', 'Ready to close', readyToClose));
  }

  var byStage = APP_CONFIG.STAGES.map(function (stage) {
    return { stage: stage, count: byStageMap[stage] || 0 };
  }).filter(function (row) {
    return row.count > 0;
  });

  return { kpis: kpis, byStage: byStage, exceptions: exceptions.slice(0, 50) };
}

function generateDepartmentReport(payload, session) {
  requireAction_(session, 'runReports', 'You do not have access to reports.');
  var roleId = resolveRoleId_(session);
  session._handoverIds = handoverIdsForUser_(session);
  var range = resolveReportPeriod_(payload || {});
  if (range.period === 'custom' && roleId !== ROLE_IDS_.ADMIN) {
    fail_('FORBIDDEN', 'Only Admin can run a custom date range.');
  }
  var department = resolveReportDepartment_(payload, session, roleId);
  var staffId = resolveReportStaffFilter_(payload, session, roleId, department);
  var stageFilter = normalizeText_(payload && payload.stage);
  var statusFilter = normalizeText_(payload && payload.status);
  var recordLimit = Math.min(Math.max(asNumber_(payload && payload.limit, 100) || 100, 1), 250);

  var scoped = [];
  readAllRecords_(APP_CONFIG.SHEETS.Enquiries.name).forEach(function (enquiry) {
    if (enquiry.stage === 'Archived' && asBoolean_(enquiry.archived)) {
      // still include closed/archived if they fall in period
    }
    if (!canViewRecord_(roleId, enquiry, session) && roleId !== ROLE_IDS_.ADMIN) return;
    var dept = enquiry.department || departmentForStage_(enquiry.stage) || '';
    if (department !== 'ALL' && dept !== department) return;
    if (staffId && enquiry.ownerId !== staffId) return;
    if (stageFilter && enquiry.stage !== stageFilter) return;
    if (statusFilter && normalizeText_(enquiry.fileStatus) !== statusFilter) return;
    if (!enquiryInReportPeriod_(enquiry, range, department === 'Operations')) return;
    scoped.push(decorateEnquiry_(enquiry, session));
  });

  var enquiryIds = {};
  scoped.forEach(function (item) {
    enquiryIds[item.enquiryId] = true;
  });

  var payments = [];
  if (department === 'Accounts' || department === 'ALL' || roleId === ROLE_IDS_.ADMIN || roleId === ROLE_IDS_.ACCOUNTS) {
    payments = readAllRecords_(APP_CONFIG.SHEETS.Payments.name).filter(function (item) {
      return enquiryIds[item.enquiryId]
        || inDateRange_(item.dueDate, range.startDate, range.endDate)
        || inDateRange_(item.paidAt, range.startDate, range.endDate);
    }).map(decoratePayment_);
    if (department !== 'ALL') {
      payments = payments.filter(function (item) {
        return enquiryIds[item.enquiryId];
      });
    }
    payments = maskPaymentsForSession_(payments, session);
  }

  var handovers = readAllRecords_(APP_CONFIG.SHEETS.Handovers.name).filter(function (item) {
    if (!enquiryIds[item.enquiryId] && !inDateRange_(item.handoverDate || item.createdAt, range.startDate, range.endDate)) {
      return false;
    }
    if (department !== 'ALL') {
      if (item.fromDepartment !== department && item.toDepartment !== department) return false;
    }
    return true;
  }).map(function (item) {
    var enquiry = findRecord_(APP_CONFIG.SHEETS.Enquiries.name, 'enquiryId', item.enquiryId);
    return {
      handoverId: item.handoverId,
      enquiryId: item.enquiryId,
      clientName: enquiry ? clientName_(enquiry.clientId) : item.enquiryId,
      fromDepartment: item.fromDepartment,
      toDepartment: item.toDepartment,
      handoverDate: item.handoverDate || dateValue_(item.createdAt),
      reason: item.reason,
      handedToName: ownerName_(item.handedTo),
      ackStatus: item.ackStatus || 'Pending'
    };
  });

  var activities = readAllRecords_(APP_CONFIG.SHEETS.Activities.name).filter(function (item) {
    if (!enquiryIds[item.enquiryId]) return false;
    return inDateRange_(item.createdAt, range.startDate, range.endDate) || inDateRange_(item.dueAt, range.startDate, range.endDate);
  }).slice(0, 100);

  var built = buildDepartmentKpis_(department, scoped, payments, handovers, range, roleId);
  var reportRef = 'RPT-' + range.period.toUpperCase().slice(0, 1) + '-' + Utilities.formatDate(new Date(), APP_CONFIG.TIMEZONE, 'yyyyMMdd-HHmm');

  return {
    reportRef: reportRef,
    header: {
      title: (department === 'ALL' ? 'Company' : department) + ' ' + range.period + ' report',
      period: range.period,
      startDate: range.startDate,
      endDate: range.endDate,
      department: department,
      staffId: staffId || '',
      roleId: roleId,
      generatedAt: nowIso_(),
      generatedBy: session.displayName || session.username || session.userId
    },
    kpis: built.kpis,
    byStage: built.byStage,
    exceptions: built.exceptions,
    records: scoped.slice(0, recordLimit),
    recordTotal: scoped.length,
    handovers: handovers.slice(0, 50),
    activities: activities,
    payments: payments.slice(0, 50)
  };
}

function getReportData(payload, session) {
  requireAction_(session, 'runReports', 'You do not have access to reports.');
  var roleId = resolveRoleId_(session);
  session._handoverIds = handoverIdsForUser_(session);
  var byStageMap = {};
  APP_CONFIG.STAGES.forEach(function (stage) {
    byStageMap[stage] = 0;
  });
  var byDepartmentMap = {};
  APP_CONFIG.DEPARTMENTS.forEach(function (dept) {
    byDepartmentMap[dept] = 0;
  });
  var liveCount = 0;
  var confirmedBookings = 0;
  var completedTrips = 0;
  var estimatedRevenue = 0;
  var bySource = {};
  var byDestination = {};

  readAllRecords_(APP_CONFIG.SHEETS.Enquiries.name).forEach(function (enquiry) {
    if (asBoolean_(enquiry.archived) && enquiry.stage !== 'Archived') return;
    if (enquiry.stage === 'Archived') return;
    if (!canViewRecord_(roleId, enquiry, session)) return;
    byStageMap[enquiry.stage] = (byStageMap[enquiry.stage] || 0) + 1;
    if (isLiveStage_(enquiry.stage)) {
      liveCount += 1;
      var dept = enquiry.department || departmentForStage_(enquiry.stage) || 'Sales';
      byDepartmentMap[dept] = (byDepartmentMap[dept] || 0) + 1;
      var source = enquiry.sourceChannel || 'unknown';
      bySource[source] = (bySource[source] || 0) + 1;
      parseJson_(enquiry.destinations, []).forEach(function (dest) {
        byDestination[dest] = (byDestination[dest] || 0) + 1;
      });
      if (enquiry.budgetAmount !== '' && enquiry.budgetAmount != null) {
        if (fieldPolicy_(roleId, 'budgetAmount') === 'full' || fieldPolicy_(roleId, 'budgetAmount') === 'read' || roleId === ROLE_IDS_.ADMIN) {
          estimatedRevenue += asNumber_(enquiry.budgetAmount, 0);
        }
      }
    }
    if (enquiry.stage === 'Confirmed booking' || enquiry.stage === 'Paid' || enquiry.stage === 'Operations in progress') {
      confirmedBookings += 1;
    }
    if (enquiry.stage === 'Travel completed') completedTrips += 1;
  });

  var work = getWorkData(payload, session);
  var unpaidCount = 0;
  if (roleId === ROLE_IDS_.ADMIN || roleId === ROLE_IDS_.ACCOUNTS) {
    unpaidCount = readAllRecords_(APP_CONFIG.SHEETS.Payments.name).filter(function (item) {
      return item.status === 'due';
    }).length;
  }
  var pendingHandovers = listPendingHandovers_(session);
  var allowedStages = stagesForRole_(roleId);
  var byStage = (roleId === ROLE_IDS_.ADMIN ? APP_CONFIG.STAGES : allowedStages).map(function (stage) {
    return { stage: stage, count: byStageMap[stage] || 0 };
  });
  var byDepartment = APP_CONFIG.DEPARTMENTS.map(function (dept) {
    return { department: dept, count: byDepartmentMap[dept] || 0 };
  });
  return {
    roleId: roleId,
    liveCount: liveCount,
    overdueCount: work.overdue.length,
    unpaidCount: unpaidCount,
    pendingHandoverCount: pendingHandovers.length,
    confirmedBookings: confirmedBookings,
    completedTrips: completedTrips,
    estimatedRevenue: estimatedRevenue,
    byStage: byStage,
    byDepartment: byDepartment,
    bySource: roleId === ROLE_IDS_.ADMIN || roleId === ROLE_IDS_.SALES
      ? Object.keys(bySource).map(function (key) { return { source: key, count: bySource[key] }; })
      : [],
    byDestination: Object.keys(byDestination).map(function (key) {
      return { destination: key, count: byDestination[key] };
    })
  };
}

function csvEscape_(value) {
  var text = String(value == null ? '' : value);
  if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function exportDepartmentReportCsv_(report) {
  var header = report.header || {};
  var lines = [];
  lines.push(csvEscape_(header.title || 'Department report'));
  lines.push('Report ref,' + csvEscape_(report.reportRef || ''));
  lines.push('Generated,' + csvEscape_(header.generatedAt || todayIso_()));
  lines.push('Generated by,' + csvEscape_(header.generatedBy || ''));
  lines.push('Period,' + csvEscape_(header.period || ''));
  lines.push('From,' + csvEscape_(header.startDate || ''));
  lines.push('To,' + csvEscape_(header.endDate || ''));
  lines.push('Department,' + csvEscape_(header.department || ''));
  lines.push('');
  lines.push('KPIs');
  lines.push('Metric,Value');
  (report.kpis || []).forEach(function (row) {
    lines.push(csvEscape_(row.label) + ',' + csvEscape_(row.value));
  });
  lines.push('');
  lines.push('By stage');
  lines.push('Stage,Count');
  (report.byStage || []).forEach(function (row) {
    lines.push(csvEscape_(row.stage) + ',' + csvEscape_(row.count));
  });
  if ((report.exceptions || []).length) {
    lines.push('');
    lines.push('Exceptions');
    lines.push('Kind,Guest,Enquiry,Summary');
    report.exceptions.forEach(function (row) {
      lines.push([
        csvEscape_(row.kind),
        csvEscape_(row.clientName),
        csvEscape_(row.enquiryId),
        csvEscape_(row.summary)
      ].join(','));
    });
  }
  lines.push('');
  lines.push('Files');
  lines.push('Guest,Enquiry,Stage,Department,Owner,Travel start,Next follow-up,Status,Budget');
  (report.records || []).forEach(function (item) {
    lines.push([
      csvEscape_(item.clientName),
      csvEscape_(item.enquiryId),
      csvEscape_(item.stage),
      csvEscape_(item.department),
      csvEscape_(item.ownerName),
      csvEscape_(item.startDate),
      csvEscape_(item.nextFollowUpAt),
      csvEscape_(item.fileStatus),
      csvEscape_(item.budgetAmount)
    ].join(','));
  });
  if ((report.handovers || []).length) {
    lines.push('');
    lines.push('Handovers');
    lines.push('Guest,Enquiry,From,To,Date,Reason,Handed to,Status');
    report.handovers.forEach(function (item) {
      lines.push([
        csvEscape_(item.clientName),
        csvEscape_(item.enquiryId),
        csvEscape_(item.fromDepartment),
        csvEscape_(item.toDepartment),
        csvEscape_(item.handoverDate),
        csvEscape_(item.reason),
        csvEscape_(item.handedToName),
        csvEscape_(item.ackStatus)
      ].join(','));
    });
  }
  if ((report.payments || []).length) {
    lines.push('');
    lines.push('Payments');
    lines.push('Guest,Enquiry,Kind,Amount,Currency,Due,Status');
    report.payments.forEach(function (item) {
      lines.push([
        csvEscape_(item.clientName),
        csvEscape_(item.enquiryId),
        csvEscape_(item.kind),
        csvEscape_(item.amount),
        csvEscape_(item.currency),
        csvEscape_(item.dueDate),
        csvEscape_(item.status)
      ].join(','));
    });
  }
  if ((report.activities || []).length) {
    lines.push('');
    lines.push('Diary');
    lines.push('Enquiry,Type,Summary,Department,Due,Created');
    report.activities.forEach(function (item) {
      lines.push([
        csvEscape_(item.enquiryId),
        csvEscape_(item.type),
        csvEscape_(item.summary),
        csvEscape_(item.department),
        csvEscape_(item.dueAt),
        csvEscape_(item.createdAt)
      ].join(','));
    });
  }
  var deptSlug = String(header.department || 'report').replace(/\s+/g, '-');
  return {
    fileName: 'Lamai-' + deptSlug + '-' + (header.period || 'report') + '-' + (header.startDate || todayIso_()) + '.csv',
    csv: lines.join('\r\n')
  };
}

function exportReportCsv(payload, session) {
  requireAction_(session, 'runReports', 'You do not have access to reports.');
  if (payload && (payload.period || payload.department || payload.date || payload.startDate)) {
    var report = generateDepartmentReport(payload, session);
    return exportDepartmentReportCsv_(report);
  }
  var roleId = resolveRoleId_(session);
  var data = getReportData(payload, session);
  var live = listEnquiries({ liveOnly: true }, session).items || [];
  var work = getWorkData(payload, session);
  var unpaid = [];
  if (roleId === ROLE_IDS_.ADMIN || roleId === ROLE_IDS_.ACCOUNTS) {
    unpaid = readAllRecords_(APP_CONFIG.SHEETS.Payments.name).filter(function (item) {
      return item.status === 'due';
    }).map(decoratePayment_);
  }
  var pendingHandovers = listPendingHandovers_(session);
  var lines = [];
  lines.push('Lamai Safaris report');
  lines.push('Generated,' + csvEscape_(todayIso_()));
  lines.push('Role,' + csvEscape_(roleId));
  lines.push('');
  lines.push('Summary');
  lines.push('Live files,' + data.liveCount);
  lines.push('Confirmed bookings,' + data.confirmedBookings);
  lines.push('Completed trips,' + data.completedTrips);
  lines.push('Overdue follow-ups,' + data.overdueCount);
  lines.push('Unpaid milestones,' + data.unpaidCount);
  lines.push('Pending handovers,' + data.pendingHandoverCount);
  lines.push('Estimated revenue,' + data.estimatedRevenue);
  lines.push('');
  lines.push('By department');
  lines.push('Department,Count');
  (data.byDepartment || []).forEach(function (row) {
    lines.push(csvEscape_(row.department) + ',' + csvEscape_(row.count));
  });
  lines.push('');
  lines.push('By stage');
  lines.push('Stage,Count');
  (data.byStage || []).forEach(function (row) {
    lines.push(csvEscape_(row.stage) + ',' + csvEscape_(row.count));
  });
  if ((data.bySource || []).length) {
    lines.push('');
    lines.push('By source');
    lines.push('Source,Count');
    data.bySource.forEach(function (row) {
      lines.push(csvEscape_(row.source) + ',' + csvEscape_(row.count));
    });
  }
  lines.push('');
  lines.push('By destination');
  lines.push('Destination,Count');
  (data.byDestination || []).forEach(function (row) {
    lines.push(csvEscape_(row.destination) + ',' + csvEscape_(row.count));
  });
  lines.push('');
  lines.push('Live files');
  lines.push('Guest,Enquiry,Stage,Department,Owner,Travel start,Next follow-up,Budget');
  live.forEach(function (item) {
    lines.push([
      csvEscape_(item.clientName),
      csvEscape_(item.enquiryId),
      csvEscape_(item.stage),
      csvEscape_(item.department),
      csvEscape_(item.ownerName),
      csvEscape_(item.startDate),
      csvEscape_(item.nextFollowUpAt),
      csvEscape_(item.budgetAmount)
    ].join(','));
  });
  lines.push('');
  lines.push('Overdue follow-ups');
  lines.push('Guest,Enquiry,Due,Action,Department');
  (work.overdue || []).forEach(function (item) {
    lines.push([
      csvEscape_(item.clientName),
      csvEscape_(item.enquiryId),
      csvEscape_(item.dueAt || item.nextFollowUpAt),
      csvEscape_(item.summary || item.nextAction),
      csvEscape_(item.department)
    ].join(','));
  });
  lines.push('');
  lines.push('Pending handovers');
  lines.push('Guest,Enquiry,From,To,Date,Reason,Handed to,Status');
  pendingHandovers.forEach(function (item) {
    lines.push([
      csvEscape_(item.clientName),
      csvEscape_(item.enquiryId),
      csvEscape_(item.fromDepartment),
      csvEscape_(item.toDepartment),
      csvEscape_(item.handoverDate),
      csvEscape_(item.reason),
      csvEscape_(item.handedToName),
      csvEscape_(item.ackStatus)
    ].join(','));
  });
  if (unpaid.length) {
    lines.push('');
    lines.push('Unpaid milestones');
    lines.push('Guest,Enquiry,Kind,Amount,Currency,Due');
    unpaid.forEach(function (item) {
      lines.push([
        csvEscape_(item.clientName),
        csvEscape_(item.enquiryId),
        csvEscape_(item.kind),
        csvEscape_(item.amount),
        csvEscape_(item.currency),
        csvEscape_(item.dueDate)
      ].join(','));
    });
  }
  return {
    fileName: 'Lamai-Safaris-report-' + todayIso_() + '.csv',
    csv: lines.join('\r\n')
  };
}
