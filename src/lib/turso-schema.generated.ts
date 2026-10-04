// GENERATED FILE — do not edit by hand.
// Source: src/convex/schema.ts   Regenerate: node scripts/gen-turso-schema.mjs
//
// One entry per Convex table, mapping each document field to a SQLite column
// kind. Tables not present here are not migrated. "users" also carries the
// @convex-dev/auth columns because auth shares that table.
//
//   text — TEXT column
//   real — REAL column
//   int  — INTEGER column (boolean, stored as 0/1)
//   json — TEXT column holding JSON (lossless for arrays/objects/unions)

/** Convex table name -> column name -> SQLite kind. */
export type SqlKind = "text" | "real" | "int" | "json";

export const MIGRATION_TABLES: Record<string, Record<string, SqlKind>> = {
  users: {
    name: "text",
    image: "text",
    email: "text",
    emailVerificationTime: "real",
    isAnonymous: "int",
    role: "text",
    studentId: "text",
    phone: "text",
    active: "int",
    telegramChatId: "text",
    telegramUsername: "text",
    membershipStatus: "json",
    profileApproved: "int",
    clubRoles: "json",
    academicState: "text",
    major: "text",
    studentCode: "text",
    dateOfBirth: "text",
    githubUrl: "text",
    printerRole: "int",
    inventoryRole: "int",
    inventoryPerms: "json",
    font: "text",
    soundSettings: "text",
    appearance: "json",
    updatedAt: "real"
  },
  closets: {
    name: "text",
    location: "text",
    note: "text",
    imageUrl: "text",
    updatedAt: "real"
  },
  categories: {
    name: "text",
    description: "text",
    consumable: "int",
    updatedAt: "real"
  },
  groups: {
    name: "text",
    categoryId: "text",
    closetId: "text",
    brand: "text",
    model: "text",
    description: "text",
    datasheetUrl: "text",
    imageUrl: "text",
    quantityTotal: "real",
    measure: "json",
    packSize: "real",
    measureUnit: "text",
    measureStock: "text",
    measureLowAt: "text",
    parentGroupId: "text",
    deleted: "int",
    updatedAt: "real"
  },
  parts: {
    groupId: "text",
    tag: "text",
    status: "json",
    note: "text",
    imageUrl: "text",
    amountRemaining: "text",
    lowAt: "text",
    consumedAt: "real",
    consumptionLog: "json",
    currentHolderId: "text",
    currentProjectId: "text",
    rentedAt: "real",
    dueAt: "real",
    transferToName: "text",
    deleted: "int",
    updatedAt: "real"
  },
  projects: {
    name: "text",
    description: "text",
    imageUrl: "text",
    status: "json",
    ownerId: "text",
    teamNo: "real",
    deleted: "int",
    updatedAt: "real"
  },
  projectMembers: {
    projectId: "text",
    userId: "text",
    role: "json",
    center: "json",
    addedAt: "real",
    addedBy: "text",
    leftAt: "real",
    team: "real"
  },
  projectTasks: {
    projectId: "text",
    center: "json",
    title: "text",
    details: "text",
    status: "json",
    priority: "json",
    assigneeId: "text",
    createdBy: "text",
    createdAt: "real",
    updatedAt: "real",
    completedAt: "real",
    dueAt: "real"
  },
  projectNotes: {
    projectId: "text",
    center: "json",
    title: "text",
    body: "text",
    url: "text",
    createdBy: "text",
    createdAt: "real"
  },
  projectReadmes: {
    projectId: "text",
    content: "text",
    version: "real",
    updatedBy: "text",
    updatedAt: "real"
  },
  readmeEditRequests: {
    projectId: "text",
    baseVersion: "real",
    baseContent: "text",
    proposedContent: "text",
    note: "text",
    submittedBy: "text",
    requestedAt: "real",
    status: "json",
    decidedAt: "real",
    decidedBy: "text",
    decisions: "json",
    finalContent: "text"
  },
  readmeHistory: {
    projectId: "text",
    content: "text",
    source: "json",
    outcome: "json",
    editedBy: "text",
    reviewerId: "text",
    at: "real",
    requestId: "text",
    added: "real",
    removed: "real",
    changed: "real",
    rejectNotes: "json"
  },
  rentalPackages: {
    userId: "text",
    note: "text",
    status: "json",
    lines: "json",
    requestedAt: "real",
    decidedAt: "real",
    pickupAt: "real",
    pickedUpAt: "real",
    returnedAt: "real",
    dueAt: "real",
    returnRequestedAt: "real",
    returnDecidedAt: "real",
    updatedAt: "real"
  },
  rentals: {
    partId: "text",
    userId: "text",
    packageId: "text",
    note: "text",
    status: "json",
    requestedAt: "real",
    decidedAt: "real",
    pickedUpAt: "real",
    pickupAt: "real",
    pickupRemindedDay: "int",
    pickupRemindedHour: "int",
    returnedAt: "real",
    dueAt: "real",
    amount: "real",
    allocations: "json",
    projectId: "text",
    returnDestination: "json",
    transferToName: "text",
    transferDetails: "text",
    transferDoc: "json",
    recoveredAmount: "real",
    conditionReport: "text",
    functional: "int",
    returnRequestedAt: "real",
    rentBroken: "int",
    updatedAt: "real"
  },
  notifications: {
    forRole: "text",
    type: "text",
    text: "text",
    link: "text",
    read: "int"
  },
  pushSubscriptions: {
    userId: "text",
    endpoint: "text",
    keysP256dh: "text",
    keysAuth: "text",
    userAgent: "text",
    platform: "text",
    createdAt: "real"
  },
  seenRequests: {
    key: "text",
    seenAt: "real",
    seenBy: "text"
  },
  settings: {
    key: "text",
    value: "text"
  },
  telegramTopics: {
    bot: "json",
    threadId: "real",
    name: "text",
    categories: "json"
  },
  profileRequests: {
    userId: "text",
    payload: "json",
    status: "json",
    requestedAt: "real",
    decidedAt: "real"
  },
  clubLists: {
    listKey: "text",
    values: "json"
  },
  rankRequests: {
    userId: "text",
    kind: "json",
    requestedRoles: "json",
    message: "text",
    status: "json",
    requestedAt: "real",
    decidedAt: "real"
  },
  printerRequests: {
    userId: "text",
    message: "text",
    status: "json",
    requestedAt: "real",
    decidedAt: "real"
  },
  inventoryRequests: {
    userId: "text",
    message: "text",
    status: "json",
    requestedAt: "real",
    decidedAt: "real"
  },
  deviceTokens: {
    userId: "text",
    tokenHash: "text",
    deviceName: "text",
    createdAt: "real",
    lastUsedAt: "real"
  },
  rentCardJobs: {
    card: "json",
    caption: "text",
    status: "json",
    attempts: "real",
    createdAt: "real",
    updatedAt: "real"
  },
  printers: {
    name: "text",
    model: "text",
    status: "json",
    buildVolumeCm: "json",
    nozzleMm: "real",
    note: "text",
    deleted: "int"
  },
  printerMaintenance: {
    printerId: "text",
    kind: "json",
    text: "text",
    byUserId: "text",
    at: "real"
  },
  filaments: {
    brand: "text",
    material: "json",
    colorName: "text",
    colorHex: "text",
    weightG: "real",
    remainingG: "text",
    inventoryGroupId: "text",
    partId: "text",
    lowAtG: "real",
    archived: "int",
    createdAt: "real"
  },
  printJobs: {
    requesterId: "text",
    name: "text",
    details: "text",
    fileUrl: "text",
    fileName: "text",
    estWeightG: "real",
    weightG: "real",
    estMinutes: "real",
    minutes: "real",
    filamentId: "text",
    printerId: "text",
    queuePos: "real",
    status: "json",
    priority: "json",
    needSlicing: "int",
    slicingNote: "text",
    slicingBy: "text",
    createdAt: "real",
    startedAt: "real",
    finishedAt: "real",
    operatedBy: "text",
    failureNote: "text",
    approvedBy: "text",
    denialNote: "text",
    archivedAt: "real"
  },
  syncTombstones: {
    table: "text",
    recordId: "text",
    deletedAt: "real"
  },
  accounts: {
    accountId: "text",
    providerAccountId: "text",
    userId: "text",
    access_token: "json",
    refresh_token: "json",
    id_token: "json",
    access_token_expires_at: "text",
    refresh_token_expires_at: "text",
    token_type: "text",
    scope: "text",
    id_token_expires_at: "text",
    session_state: "text"
  },
  sessions: {
    userId: "text",
    expirationTime: "real"
  },
  verificationTokens: {
    identifier: "text",
    token: "text",
    expirationTime: "real"
  },
  passwordResetTokens: {
    identifier: "text",
    token: "text",
    expirationTime: "real"
  }
};

/** Convex secondary indexes -> the SQLite indexes that replace them. */
export const MIGRATION_INDEXES: Record<string, { name: string; columns: string[] }[]> = {
  users: [
    {
      name: "email",
      columns: [
        "email"
      ]
    },
    {
      name: "by_telegram_username",
      columns: [
        "telegramUsername"
      ]
    },
    {
      name: "by_updatedAt",
      columns: [
        "updatedAt"
      ]
    },
    {
      name: "by_role",
      columns: [
        "role"
      ]
    },
    {
      name: "by_profileApproved",
      columns: [
        "profileApproved"
      ]
    }
  ],
  closets: [
    {
      name: "by_name",
      columns: [
        "name"
      ]
    },
    {
      name: "by_updatedAt",
      columns: [
        "updatedAt"
      ]
    }
  ],
  categories: [
    {
      name: "by_name",
      columns: [
        "name"
      ]
    },
    {
      name: "by_updatedAt",
      columns: [
        "updatedAt"
      ]
    }
  ],
  groups: [
    {
      name: "by_category",
      columns: [
        "categoryId"
      ]
    },
    {
      name: "by_closet",
      columns: [
        "closetId"
      ]
    },
    {
      name: "by_updatedAt",
      columns: [
        "updatedAt"
      ]
    }
  ],
  parts: [
    {
      name: "by_group",
      columns: [
        "groupId"
      ]
    },
    {
      name: "by_tag",
      columns: [
        "tag"
      ]
    },
    {
      name: "by_updatedAt",
      columns: [
        "updatedAt"
      ]
    }
  ],
  projects: [
    {
      name: "by_status",
      columns: [
        "status"
      ]
    },
    {
      name: "by_updatedAt",
      columns: [
        "updatedAt"
      ]
    }
  ],
  projectMembers: [
    {
      name: "by_project",
      columns: [
        "projectId"
      ]
    },
    {
      name: "by_user",
      columns: [
        "userId"
      ]
    }
  ],
  projectTasks: [
    {
      name: "by_project",
      columns: [
        "projectId"
      ]
    },
    {
      name: "by_assignee",
      columns: [
        "assigneeId"
      ]
    }
  ],
  projectNotes: [
    {
      name: "by_project",
      columns: [
        "projectId"
      ]
    }
  ],
  projectReadmes: [
    {
      name: "by_project",
      columns: [
        "projectId"
      ]
    }
  ],
  readmeEditRequests: [
    {
      name: "by_project",
      columns: [
        "projectId"
      ]
    },
    {
      name: "by_status",
      columns: [
        "status"
      ]
    }
  ],
  readmeHistory: [
    {
      name: "by_project",
      columns: [
        "projectId"
      ]
    },
    {
      name: "by_request",
      columns: [
        "requestId"
      ]
    }
  ],
  rentalPackages: [
    {
      name: "by_user",
      columns: [
        "userId"
      ]
    },
    {
      name: "by_status",
      columns: [
        "status"
      ]
    },
    {
      name: "by_updatedAt",
      columns: [
        "updatedAt"
      ]
    }
  ],
  rentals: [
    {
      name: "by_user",
      columns: [
        "userId"
      ]
    },
    {
      name: "by_part",
      columns: [
        "partId"
      ]
    },
    {
      name: "by_status",
      columns: [
        "status"
      ]
    },
    {
      name: "by_package",
      columns: [
        "packageId"
      ]
    },
    {
      name: "by_updatedAt",
      columns: [
        "updatedAt"
      ]
    }
  ],
  notifications: [
    {
      name: "by_read",
      columns: [
        "read"
      ]
    }
  ],
  pushSubscriptions: [
    {
      name: "by_endpoint",
      columns: [
        "endpoint"
      ]
    },
    {
      name: "by_user",
      columns: [
        "userId"
      ]
    }
  ],
  seenRequests: [
    {
      name: "by_key",
      columns: [
        "key"
      ]
    }
  ],
  settings: [
    {
      name: "by_key",
      columns: [
        "key"
      ]
    }
  ],
  telegramTopics: [
    {
      name: "by_bot",
      columns: [
        "bot"
      ]
    }
  ],
  profileRequests: [
    {
      name: "by_status",
      columns: [
        "status"
      ]
    },
    {
      name: "by_user_status",
      columns: [
        "userId",
        "status"
      ]
    }
  ],
  clubLists: [
    {
      name: "by_list_key",
      columns: [
        "listKey"
      ]
    }
  ],
  rankRequests: [
    {
      name: "by_status",
      columns: [
        "status"
      ]
    },
    {
      name: "by_user_status",
      columns: [
        "userId",
        "status"
      ]
    }
  ],
  printerRequests: [
    {
      name: "by_status",
      columns: [
        "status"
      ]
    },
    {
      name: "by_user_status",
      columns: [
        "userId",
        "status"
      ]
    }
  ],
  inventoryRequests: [
    {
      name: "by_status",
      columns: [
        "status"
      ]
    },
    {
      name: "by_user_status",
      columns: [
        "userId",
        "status"
      ]
    }
  ],
  deviceTokens: [
    {
      name: "by_tokenHash",
      columns: [
        "tokenHash"
      ]
    },
    {
      name: "by_user",
      columns: [
        "userId"
      ]
    }
  ],
  rentCardJobs: [
    {
      name: "by_status",
      columns: [
        "status"
      ]
    },
    {
      name: "by_created",
      columns: [
        "createdAt"
      ]
    }
  ],
  printers: [
    {
      name: "by_status",
      columns: [
        "status"
      ]
    }
  ],
  printerMaintenance: [
    {
      name: "by_printer",
      columns: [
        "printerId"
      ]
    }
  ],
  filaments: [
    {
      name: "by_archived",
      columns: [
        "archived"
      ]
    }
  ],
  printJobs: [
    {
      name: "by_status",
      columns: [
        "status"
      ]
    },
    {
      name: "by_printer",
      columns: [
        "printerId"
      ]
    },
    {
      name: "by_requester",
      columns: [
        "requesterId"
      ]
    }
  ],
  syncTombstones: [
    {
      name: "by_deletedAt",
      columns: [
        "deletedAt"
      ]
    },
    {
      name: "by_table_deletedAt",
      columns: [
        "table",
        "deletedAt"
      ]
    }
  ],
  accounts: [],
  sessions: [],
  verificationTokens: [],
  passwordResetTokens: []
};

export const MIGRATION_TABLE_NAMES: readonly string[] = Object.keys(MIGRATION_TABLES);
