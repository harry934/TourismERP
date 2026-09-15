function getReportData(payload, session) {
  requireAdmin_(session);
  var byStageMap = {};
  APP_CONFIG.STAGES.forEach(function (stage) {
    byStageMap[stage] = 0;
  });
  var liveCount = 0;
  readAllRecords_(APP_CONFIG.SHEETS.Enquiries.name).forEach(function (enquiry) {
    if (asBoolean_(enquiry.archived)) return;
    byStageMap[enquiry.stage] = (byStageMap[enquiry.stage] || 0) + 1;
    if (isLiveStage_(enquiry.stage)) liveCount += 1;
  });
  var work = getWorkData(payload, session);
  var unpaidCount = readAllRecords_(APP_CONFIG.SHEETS.Payments.name).filter(function (item) {
    return item.status === 'due';
  }).length;
  var byStage = APP_CONFIG.STAGES.map(function (stage) {
    return { stage: stage, count: byStageMap[stage] || 0 };
  });
  return {
    liveCount: liveCount,
    overdueCount: work.overdue.length,
    unpaidCount: unpaidCount,
    byStage: byStage
  };
}

function csvEscape_(value) {
  var text = String(value == null ? '' : value);
  if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function exportReportCsv(payload, session) {
  requireAdmin_(session);
  var data = getReportData(payload, session);
  var live = listEnquiries({ liveOnly: true }, session).items || [];
  var work = getWorkData(payload, session);
  var unpaid = readAllRecords_(APP_CONFIG.SHEETS.Payments.name).filter(function (item) {
    return item.status === 'due';
  }).map(decoratePayment_);
  var lines = [];
  lines.push('Lamai Safaris report');
  lines.push('Generated,' + csvEscape_(todayIso_()));
  lines.push('');
  lines.push('Summary');
  lines.push('Live files,' + data.liveCount);
  lines.push('Overdue follow-ups,' + data.overdueCount);
  lines.push('Unpaid milestones,' + data.unpaidCount);
  lines.push('');
  lines.push('By stage');
  lines.push('Stage,Count');
  (data.byStage || []).forEach(function (row) {
    lines.push(csvEscape_(row.stage) + ',' + csvEscape_(row.count));
  });
  lines.push('');
  lines.push('Live files');
  lines.push('Guest,Enquiry,Stage,Owner,Travel start,Next follow-up');
  live.forEach(function (item) {
    lines.push([
      csvEscape_(item.clientName),
      csvEscape_(item.enquiryId),
      csvEscape_(item.stage),
      csvEscape_(item.ownerName),
      csvEscape_(item.startDate),
      csvEscape_(item.nextFollowUpAt)
    ].join(','));
  });
  lines.push('');
  lines.push('Overdue follow-ups');
  lines.push('Guest,Enquiry,Due,Action');
  (work.overdue || []).forEach(function (item) {
    lines.push([
      csvEscape_(item.clientName),
      csvEscape_(item.enquiryId),
      csvEscape_(item.dueAt || item.nextFollowUpAt),
      csvEscape_(item.summary || item.nextAction)
    ].join(','));
  });
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
  return {
    fileName: 'Lamai-Safaris-report-' + todayIso_() + '.csv',
    csv: lines.join('\r\n')
  };
}
