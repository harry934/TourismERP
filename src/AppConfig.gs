var APP_CONFIG = {
  TIMEZONE: 'Africa/Dar_es_Salaam',
  SESSION_SECONDS: 21600,
  HASH_ROUNDS: 32,
  ROLES: {
    SUPER_ADMIN: 'Super Admin',
    STAFF: 'Staff'
  },
  STAGES: [
    'New enquiry',
    'Quoting',
    'Follow-up',
    'Accepted',
    'Confirmed booking',
    'Reservations in progress',
    'Supplier booking completed',
    'Awaiting payment',
    'Paid',
    'Operations in progress',
    'Travel completed',
    'Closed',
    'Archived'
  ],
  DEPARTMENTS: ['Sales', 'Reservations', 'Accounts', 'Operations'],
  STAGE_DEPARTMENT: {
    'New enquiry': 'Sales',
    Quoting: 'Sales',
    'Follow-up': 'Sales',
    Accepted: 'Sales',
    'Confirmed booking': 'Reservations',
    'Reservations in progress': 'Reservations',
    'Supplier booking completed': 'Reservations',
    'Awaiting payment': 'Accounts',
    Paid: 'Accounts',
    'Operations in progress': 'Operations',
    'Travel completed': 'Operations',
    Closed: '',
    Archived: ''
  },
  FILE_STATUSES: ['Pending', 'Delayed', 'Confirmed', 'Paid', 'Completed'],
  PRIORITIES: ['Low', 'Normal', 'High', 'Urgent'],
  WORK_LABELS: ['Sales', 'Reservations', 'Accounts', 'Operations', 'Guide'],
  LEGACY_STAGE_MAP: {
    New: 'New enquiry',
    Qualifying: 'New enquiry',
    Designing: 'Quoting',
    Quoted: 'Quoting',
    'Option held': 'Follow-up',
    'Deposit due': 'Awaiting payment',
    Confirmed: 'Confirmed booking',
    'Balance due': 'Awaiting payment',
    Travelling: 'Operations in progress',
    Completed: 'Travel completed',
    Lost: 'Closed'
  },
  SHEETS: {
    Users: {
      name: 'Users',
      primaryKey: 'userId',
      columns: [
        'userId',
        'staffUid',
        'username',
        'displayName',
        'email',
        'passwordHash',
        'role',
        'workLabel',
        'isActive',
        'mustChangePassword',
        'sessionEpoch',
        'createdAt',
        'updatedAt',
        'createdBy'
      ]
    },
    Clients: {
      name: 'Clients',
      primaryKey: 'clientId',
      columns: [
        'clientId',
        'fullName',
        'email',
        'phoneCountry',
        'phoneNumber',
        'nationality',
        'partyType',
        'languageNotes',
        'source',
        'notes',
        'createdBy',
        'createdAt',
        'updatedAt',
        'archived'
      ]
    },
    Enquiries: {
      name: 'Enquiries',
      primaryKey: 'enquiryId',
      columns: [
        'enquiryId',
        'clientId',
        'ownerId',
        'stage',
        'department',
        'priority',
        'status',
        'bookingRef',
        'sourceChannel',
        'travelStyle',
        'destinations',
        'startDate',
        'endDate',
        'flexible',
        'flexibleMonth',
        'adults',
        'children',
        'childAges',
        'lodgeBand',
        'budgetType',
        'budgetAmount',
        'currency',
        'itineraryOutline',
        'activityNotes',
        'specialRequests',
        'nextFollowUpAt',
        'nextAction',
        'lostReason',
        'operationsIssue',
        'tripCompletionStatus',
        'supplierNotes',
        'createdBy',
        'createdAt',
        'updatedAt',
        'archived'
      ]
    },
    Activities: {
      name: 'Activities',
      primaryKey: 'activityId',
      columns: [
        'activityId',
        'enquiryId',
        'type',
        'summary',
        'department',
        'outcome',
        'nextAction',
        'dueAt',
        'completedAt',
        'createdBy',
        'createdAt'
      ]
    },
    Handovers: {
      name: 'Handovers',
      primaryKey: 'handoverId',
      columns: [
        'handoverId',
        'enquiryId',
        'fromDepartment',
        'toDepartment',
        'handoverDate',
        'reason',
        'handedBy',
        'handedTo',
        'remarks',
        'ackStatus',
        'createdAt'
      ]
    },
    Payments: {
      name: 'Payments',
      primaryKey: 'paymentId',
      columns: [
        'paymentId',
        'enquiryId',
        'kind',
        'amount',
        'currency',
        'dueDate',
        'status',
        'receivedAt',
        'note',
        'createdAt',
        'updatedAt'
      ]
    },
    Settings: {
      name: 'Settings',
      primaryKey: 'key',
      columns: ['key', 'value', 'updatedAt']
    },
    ReferenceData: {
      name: 'ReferenceData',
      primaryKey: 'itemId',
      columns: ['itemId', 'kind', 'label', 'isActive', 'sortOrder']
    },
    AuditLog: {
      name: 'AuditLog',
      primaryKey: 'auditId',
      columns: ['auditId', 'actorUserId', 'action', 'entityType', 'entityId', 'summary', 'createdAt']
    }
  },
  COMPANY_DEFAULTS: {
    legalName: 'Lamai Africa Safaris Ltd',
    office: 'House #64 Kishori, Moshono, Arusha, Tanzania',
    postal: 'P.O. Box 3191, Arusha',
    phone: '+255 768 506 258',
    email: 'info@lamaisafaris.com',
    tin: '173-172-885',
    timezone: 'Africa/Dar_es_Salaam'
  },
  DESTINATIONS: [
    'Serengeti',
    'Ngorongoro',
    'Kilimanjaro',
    'Lake Eyasi / Hadzabe',
    'Other'
  ],
  STYLES: [
    'family',
    'honeymoon',
    'photography',
    'walking',
    'cultural/Hadza',
    'luxury',
    'mixed'
  ]
};
