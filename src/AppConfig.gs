var APP_CONFIG = {
  TIMEZONE: 'Africa/Dar_es_Salaam',
  SESSION_SECONDS: 21600,
  HASH_ROUNDS: 32,
  ROLES: {
    SUPER_ADMIN: 'Super Admin',
    STAFF: 'Staff'
  },
  STAGES: [
    'New',
    'Qualifying',
    'Designing',
    'Quoted',
    'Option held',
    'Deposit due',
    'Confirmed',
    'Balance due',
    'Travelling',
    'Completed',
    'Lost'
  ],
  WORK_LABELS: ['Sales', 'Reservations', 'Operations', 'Guide'],
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
        'dueAt',
        'completedAt',
        'createdBy',
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
