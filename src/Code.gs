var PUBLIC_METHODS_ = {
  getBootstrap: true,
  setupSuperAdmin: true,
  login: true
};

var AUTH_WITHOUT_PASSWORD_GATE_ = {
  getBootstrap: true,
  logout: true,
  changePassword: true
};

var METHOD_HANDLERS_ = {
  getBootstrap: getBootstrap,
  setupSuperAdmin: setupSuperAdmin,
  login: login,
  logout: logout,
  changePassword: changePassword,
  getDashboardData: getDashboardData,
  listEnquiries: listEnquiries,
  getEnquiryDetail: getEnquiryDetail,
  createEnquiry: createEnquiry,
  updateEnquiry: updateEnquiry,
  transitionEnquiry: transitionEnquiry,
  listClients: listClients,
  getClientDetail: getClientDetail,
  createClient: createClient,
  updateClient: updateClient,
  createActivity: createActivity,
  getWorkData: getWorkData,
  listHandovers: listHandovers,
  createHandover: createHandover,
  acknowledgeHandover: acknowledgeHandover,
  listPayments: listPayments,
  generatePaymentMilestones: generatePaymentMilestones,
  markPaymentPaid: markPaymentPaid,
  updatePayment: updatePayment,
  getReportData: getReportData,
  getAdminData: getAdminData,
  createUser: createUser,
  updateUser: updateUser,
  deactivateUser: deactivateUser,
  deleteUser: deleteUser,
  deleteClient: deleteClient,
  resetStaffPassword: resetStaffPassword,
  updateSettings: updateSettings,
  saveReferenceItem: saveReferenceItem,
  searchWorkspace: searchWorkspace,
  getNotificationData: getNotificationData,
  exportReportCsv: exportReportCsv,
  listArchivedEnquiries: listArchivedEnquiries
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Lamai Africa Safaris')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function api(request) {
  try {
    var input = request && typeof request === 'object' ? request : {};
    var method = requireString_(input.method, 'Method', { maxLength: 80 });
    var handler = METHOD_HANDLERS_[method];
    if (!handler) fail_('UNKNOWN_METHOD', 'Unknown method.');
    var payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
    var session = null;
    if (!PUBLIC_METHODS_[method]) {
      session = AUTH_WITHOUT_PASSWORD_GATE_[method]
        ? getSession_(input.token)
        : requireSession_(input.token);
      if (!session && method !== 'logout') fail_('UNAUTHENTICATED', 'Please sign in again.');
    } else if (method === 'getBootstrap') {
      session = getSession_(input.token);
    }
    var data = handler(payload, session);
    return { ok: true, data: data };
  } catch (error) {
    return {
      ok: false,
      code: error.code || 'ERROR',
      message: error.message || 'Something went wrong.'
    };
  }
}
