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

function exportReportCsv(payload, session) {
  requireAction_(session, 'runReports', 'You do not have access to reports.');
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
