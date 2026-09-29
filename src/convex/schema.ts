import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
  STUDENT: "student",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
  v.literal(ROLES.STUDENT),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
      studentId: v.optional(v.string()),
      phone: v.optional(v.string()),
      active: v.optional(v.boolean()),

      // Telegram integration: per-member chat id (linked via the bot /start
      // flow) and the member's own @username (used to tag them in the club
      // group and for t.me deep links).
      telegramChatId: v.optional(v.string()),
      telegramUsername: v.optional(v.string()),
      // "active" = current member, "ex" = no longer in the club (kept for history).
      membershipStatus: v.optional(v.union(v.literal("active"), v.literal("ex"))),
      // Set true when an admin approves the member's profile (name + student id).
      // Members with seeded/legacy data are grandfathered; brand-new sign-ups
      // stay view-only until an admin approves their submitted profile.
      profileApproved: v.optional(v.boolean()),

      // Real club positions (e.g. رئيس نادي الروبوت, منسق النادي, عضو علمي …)
      clubRoles: v.optional(v.array(v.string())),
      academicState: v.optional(v.string()),
      major: v.optional(v.string()),
      studentCode: v.optional(v.string()), // e.g. STU-0002 (reference sheet ID)

      // Member extras: date of birth (ISO string "YYYY-MM-DD", shown as age
      // across the app) and GitHub profile URL (requested via the profile
      // change flow and applied on admin approval).
      dateOfBirth: v.optional(v.string()),
      githubUrl: v.optional(v.string()),

      // "printer" is a privilege, NOT a role: it stacks on top of any role
      // (member + printer, student + printer). Admins have it implicitly.
      printerRole: v.optional(v.boolean()),

      // Per-user notification sound settings (JSON SoundSettings): every
      // member tunes their own tones in Settings/Profile — sounds are NOT
      // global anymore.
      soundSettings: v.optional(v.string()),
      // Per-user appearance: which app mode this member prefers — "dark",
      // "light" or "system" (follow the OS). Everyone picks their own; it
      // only affects their own devices.
      appearance: v.optional(
        v.union(v.literal("dark"), v.literal("light"), v.literal("system")),
      ),
    })
      .index("email", ["email"]) // index for the email. do not remove or modify
      .index("by_telegram_username", ["telegramUsername"]),

    // ===== Robotics Club Inventory =====

    closets: defineTable({
      name: v.string(),
      location: v.optional(v.string()),
      note: v.optional(v.string()),
      // Storage photo (compressed data URL or URL) shown on storage cards.
      imageUrl: v.optional(v.string()),
    })
      .index("by_name", ["name"]),

    categories: defineTable({
      name: v.string(),
      description: v.optional(v.string()),
      // Consumables (filament, wire, resin…) are used up rather than returned:
      // returns of such groups record how much actually came back and the
      // group can take routine "consumption" writes without a rental.
      consumable: v.optional(v.boolean()),
    }).index("by_name", ["name"]),

    groups: defineTable({
      name: v.string(),
      categoryId: v.id("categories"),
      closetId: v.id("closets"),
      brand: v.optional(v.string()),
      model: v.optional(v.string()),
      description: v.optional(v.string()),
      datasheetUrl: v.optional(v.string()),
      imageUrl: v.optional(v.string()),
      quantityTotal: v.number(),
      // How this group is counted: "count" = discrete units (default);
      // "weight" = filament, resin, screws by mass; "length" = wires, tubes;
      // "pack" = whole packs of small items (jumper wires), where every pack
      // is a QR-tagged unit that carries the same number of pieces inside
      // (groups.packSize). Packs rent/return whole, like count groups.
      measure: v.optional(
        v.union(
          v.literal("count"),
          v.literal("weight"),
          v.literal("length"),
          v.literal("pack"),
        ),
      ),
      // For "pack" groups: how many pieces are inside ONE pack (e.g. 40
      // jumper wires per pack). Displayed as "40 pieces/pack".
      packSize: v.optional(v.number()),
      // Display unit for weight/length groups: "kg" | "g" | "m" | "cm" | "mm".
      measureUnit: v.optional(v.string()),
      // For weight/length groups: current stock in `measureUnit` (number as
      // string to avoid float drift), e.g. "1.25" kg of PLA.
      measureStock: v.optional(v.string()),
      // Stock level considered low — the admin console flags it.
      measureLowAt: v.optional(v.string()),
      // Group-of-groups: when set, this group is displayed INSIDE a container
      // group (e.g. a box of mixed components). Containers are normal groups —
      // they can also hold units, so nothing else changes.
      parentGroupId: v.optional(v.id("groups")),
      deleted: v.optional(v.boolean()),
    })
      .index("by_category", ["categoryId"])
      .index("by_closet", ["closetId"]),

    parts: defineTable({
      groupId: v.id("groups"),
      tag: v.string(), // unique physical tag, e.g. ARD-UNO-003
      status: v.union(
        v.literal("available"),
        v.literal("pending"),
        v.literal("rented"),
        v.literal("on_project"),
        v.literal("broken"),
        // Terminal states that keep the record (QR still resolves) but take
        // the unit out of circulating stock: handed over to another
        // department/lab ("transferred") or written off as used up
        // ("consumed", consumables only).
        v.literal("transferred"),
        v.literal("consumed"),
      ),
      note: v.optional(v.string()),
      // Optional per-unit photo (URL) shown next to the unit's QR chip and on
      // rent cards; falls back to the group image when not set.
      imageUrl: v.optional(v.string()),
      // Weight/length (measure-based) groups track stock PER UNIT: each unit
      // (reel, spool, tube…) holds its own remaining amount in the group's
      // measureUnit, e.g. "3" meters of wire or "0.85" kg of PLA. Rentals of
      // such groups cut across units instead of taking a unit out whole.
      amountRemaining: v.optional(v.string()),
      // Per-unit minimum: a partial take may never leave the unit below this
      // amount (inherited from the group's measureLowAt when created).
      lowAt: v.optional(v.string()),
      // When the unit was marked FULLY consumed (routine inventory write-off
      // or the last cut emptied it). Cleared automatically when stock returns.
      consumedAt: v.optional(v.number()),
      // Consumption audit trail for routine inventory writes: every manual
      // "consumed X" / "fully consumed" / returned-consumption entry.
      consumptionLog: v.optional(
        v.array(
          v.object({
            amount: v.number(), // negative = stock removed, positive = added back
            at: v.number(),
            byId: v.optional(v.id("users")),
            byName: v.optional(v.string()),
            via: v.string(), // "manual" | "full" | "return"
            note: v.optional(v.string()),
          }),
        ),
      ),
      currentHolderId: v.optional(v.id("users")),
      currentProjectId: v.optional(v.id("projects")),
      // Manual lend dates (admin hands a unit to a member): when the loan
      // started and when it should come back. Cleared on return.
      rentedAt: v.optional(v.number()),
      dueAt: v.optional(v.number()),
      // "transferred" units: where the unit went (another department, a
      // donated lab…). Kept on the unit so its card always shows the
      // destination; cleared when the unit returns to circulation.
      transferToName: v.optional(v.string()),
      deleted: v.optional(v.boolean()),
    })
      .index("by_group", ["groupId"])
      .index("by_tag", ["tag"]),

    projects: defineTable({
      name: v.string(),
      description: v.optional(v.string()),
      // Project cover image (compressed data URL or URL) shown on cards.
      imageUrl: v.optional(v.string()),
      status: v.union(
        v.literal("active"),
        v.literal("completed"),
        v.literal("dismantled"),
      ),
      ownerId: v.optional(v.id("users")),
      deleted: v.optional(v.boolean()),
    }).index("by_status", ["status"]),

    // ===== Project workspace (professional working center) =====

    // A person assigned to work on a project. `role` distinguishes the team
    // leader (assigns missions, follows the team) from regular contributors.
    projectMembers: defineTable({
      projectId: v.id("projects"),
      userId: v.id("users"),
      role: v.union(v.literal("leader"), v.literal("member")),
      // Optional center specialization, e.g. "programming" — informational.
      center: v.optional(
        v.union(
          v.literal("mechanical"),
          v.literal("electrical"),
          v.literal("programming"),
          v.literal("inventory"),
        ),
      ),
      addedAt: v.number(),
      addedBy: v.optional(v.id("users")),
    })
      .index("by_project", ["projectId"])
      .index("by_user", ["userId"]),

    // A mission (task) inside one of the project's six centers.
    projectTasks: defineTable({
      projectId: v.id("projects"),
      center: v.union(
        v.literal("mechanical"),
        v.literal("electrical"),
        v.literal("inventory"),
        v.literal("programming"),
        v.literal("references"),
        v.literal("students"),
      ),
      title: v.string(),
      details: v.optional(v.string()),
      status: v.union(
        v.literal("todo"),
        v.literal("doing"),
        v.literal("review"),
        v.literal("done"),
      ),
      priority: v.union(v.literal("low"), v.literal("normal"), v.literal("high"), v.literal("urgent")),
      assigneeId: v.optional(v.id("users")),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
      completedAt: v.optional(v.number()),
      dueAt: v.optional(v.number()),
    })
      .index("by_project", ["projectId"])
      .index("by_assignee", ["assigneeId"]),

    // Free-form pinned notes / references stored inside one center
    // (datasheet links, design decisions, meeting summaries…).
    projectNotes: defineTable({
      projectId: v.id("projects"),
      center: v.union(
        v.literal("mechanical"),
        v.literal("electrical"),
        v.literal("inventory"),
        v.literal("programming"),
        v.literal("references"),
        v.literal("students"),
      ),
      title: v.string(),
      body: v.optional(v.string()),
      url: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
    }).index("by_project", ["projectId"]),

    // A package bundles several units (possibly from different groups) into one
    // rental request — "lend me 3 Arduino Unos and 2 servo motors in one go".
    // Each concrete unit in the package is still a row in `rentals` (so per-part
    // returns, rent cards and QRs keep working); the package groups them and is
    // editable/cancellable by the member until an admin approves it.
    rentalPackages: defineTable({
      userId: v.id("users"),
      note: v.optional(v.string()),
      // "pending" until an admin approves; then "approved". Member can edit or
      // cancel freely while pending.
      status: v.union(v.literal("pending"), v.literal("approved"), v.literal("canceled")),
      // [{ groupId, count, note }] — concrete units are chosen at request time
      // and live on the linked `rentals` rows (by packageId).
      lines: v.array(
        v.object({
          groupId: v.id("groups"),
          count: v.number(),
          note: v.optional(v.string()),
        }),
      ),
      requestedAt: v.number(),
      decidedAt: v.optional(v.number()),
      // Scheduled pick-up for approved packages — mirrors rentals.pickupAt so
      // package units follow the same approve → hand-over stage as singles.
      pickupAt: v.optional(v.number()),
      // Timestamp of the member's most recent package-level return request.
      returnRequestedAt: v.optional(v.number()),
      // When the admin processes the package return (all-or-nothing).
      returnDecidedAt: v.optional(v.number()),
    })
      .index("by_user", ["userId"])
      .index("by_status", ["status"]),

    rentals: defineTable({
      partId: v.id("parts"),
      userId: v.id("users"),
      // Set when this unit was requested as part of a package rental.
      packageId: v.optional(v.id("rentalPackages")),
      status: v.union(
        v.literal("pending"),
        v.literal("approved"),
        // "approved" = admin said yes but the unit has NOT been handed over
        // yet; "active" = admin confirmed the handover (taken/picked up) —
        // inventory decrements exactly at that moment.
        v.literal("active"),
        v.literal("on_project"),
        v.literal("returned"),
        v.literal("denied"),
        v.literal("canceled"),
      ),
      requestedAt: v.number(),
      decidedAt: v.optional(v.number()),
      pickedUpAt: v.optional(v.number()),
      // Pickup scheduling: when the approved member should come take the part.
      // Set at approval time; reminders fire 1 day + 1 hour before.
      pickupAt: v.optional(v.number()),
      pickupRemindedDay: v.optional(v.boolean()),
      pickupRemindedHour: v.optional(v.boolean()),
      returnedAt: v.optional(v.number()),
      // Return-by date when the admin sets lend dates on a manual edit.
      dueAt: v.optional(v.number()),
      // Weight/length rentals (measure-based groups): amount taken, in the
      // group's measureUnit, e.g. 0.25 (kg) or 120 (cm).
      amount: v.optional(v.number()),
      // How the take was split across the group's physical units (reels,
      // spools…): [{ partId, amount }]. Written at hand-over; returns restore
      // each unit from this list.
      allocations: v.optional(
        v.array(v.object({ partId: v.id("parts"), amount: v.number() })),
      ),
      projectId: v.optional(v.id("projects")),
      returnDestination: v.optional(
        v.union(v.literal("shelf"), v.literal("project"), v.literal("transferred")),
      ),
      // Transfer: where the unit went (free name, e.g. another department,
      // a donated school lab…), free-text details and an optional doc/photo
      // (small data URL) kept as the official record.
      transferToName: v.optional(v.string()),
      transferDetails: v.optional(v.string()),
      transferDoc: v.optional(
        v.object({
          name: v.string(),
          mime: v.string(),
          size: v.number(),
          dataUrl: v.string(),
        }),
      ),
      // Bulk (weight/length) consumable returns: the amount actually recovered
      // and re-shelved; the rest of the taken amount is recorded as consumed.
      recoveredAmount: v.optional(v.number()),
      conditionReport: v.optional(v.string()),
      functional: v.optional(v.boolean()),
      // Timestamp of the member's most recent "I want to return this" request.
      // Cleared when the return is processed; rate-limited by a configurable
      // cooldown (settings key return_request_cooldown_hours).
      returnRequestedAt: v.optional(v.number()),
      // True when the member knowingly rented a unit flagged broken.
      rentBroken: v.optional(v.boolean()),
    })
      .index("by_user", ["userId"])
      .index("by_part", ["partId"])
      .index("by_status", ["status"]),

    notifications: defineTable({
      forRole: v.literal("admin"),
      type: v.string(),
      text: v.string(),
      link: v.optional(v.string()),
      read: v.optional(v.boolean()),
    }).index("by_read", ["read"]),

    // Web-push subscriptions (VAPID): one row per browser/device that enabled
    // push. endpoint is unique per device; keys holds the per-subscription
    // p256dh/auth material. Platform-agnostic — works for PWA/browser, the
    // Android APK webview, iOS 16.4+ home-screen PWAs and desktop wrappers
    // that expose the standard Push API.
    pushSubscriptions: defineTable({
      userId: v.id("users"),
      endpoint: v.string(),
      keysP256dh: v.string(),
      keysAuth: v.string(),
      userAgent: v.optional(v.string()),
      platform: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_endpoint", ["endpoint"])
      .index("by_user", ["userId"]),

    // Which request/entity ids the admin has SEEN (acked) — powers the
    // Updates tab: it lists unseen rows from every module and drops each one
    // as soon as it is actioned or explicitly marked seen.
    seenRequests: defineTable({
      key: v.string(),
      seenAt: v.number(),
      seenBy: v.optional(v.id("users")),
    }).index("by_key", ["key"]),

    settings: defineTable({
      key: v.string(),
      value: v.optional(v.string()),
    }).index("by_key", ["key"]),
    // settings keys used by the app:
    //  - "telegram"                        { botToken, printerBotToken, clubGroupChatId,
    //                                        printerGroupChatId, notificationsOn }
    //  - "return_request_cooldown_hours"   number as JSON string

    // Telegram topic routing. The APP group has topics (forum) enabled: the
    // admin manages the topic list here and assigns each notification
    // category (rentals, printers, projects, members, inventory…) to one
    // topic. `bot` selects which group the topic lives in — "app" (club
    // group, APP BOT) or "printer" (print-farm group, PRINTER BOT).
    telegramTopics: defineTable({
      bot: v.union(v.literal("app"), v.literal("printer")),
      // Telegram forum topic id (message_thread_id from getUpdates / URL).
      threadId: v.number(),
      name: v.string(),
      // Notification categories routed into this topic.
      categories: v.array(v.string()),
    }).index("by_bot", ["bot"]),

    profileRequests: defineTable({
      userId: v.id("users"),
      payload: v.object({
        name: v.optional(v.string()),
        studentId: v.optional(v.string()),
        phone: v.optional(v.string()),
        // member-requested avatar change (admin approves before it shows)
        image: v.optional(v.string()),
        // member-requested Telegram handle/chat-id change
        telegramUsername: v.optional(v.string()),
        telegramChatId: v.optional(v.string()),
        // member-requested personal data changes (admin approves first)
        dateOfBirth: v.optional(v.string()), // ISO "YYYY-MM-DD"
        githubUrl: v.optional(v.string()),
      }),
      status: v.union(v.literal("pending"), v.literal("approved"), v.literal("denied")),
      requestedAt: v.number(),
      decidedAt: v.optional(v.number()),
    }).index("by_status", ["status"]),

    // Admin-editable club lists: ranks/positions and academic states. Stored
    // as one row per list; full CRUD from the Settings page (never hardcoded).
    clubLists: defineTable({
      listKey: v.string(), // "clubRoles" | "academicStates"
      values: v.array(v.string()),
    }).index("by_list_key", ["listKey"]),

    // Member-submitted rank/position upgrade requests (e.g. "make me مدرب").
    // `kind` distinguishes a rank request (list of club positions) from a
    // membership upgrade request (a student asking to become a full member).
    rankRequests: defineTable({
      userId: v.id("users"),
      kind: v.optional(v.union(v.literal("rank"), v.literal("member"))),
      requestedRoles: v.array(v.string()),
      message: v.optional(v.string()),
      status: v.union(v.literal("pending"), v.literal("approved"), v.literal("denied")),
      requestedAt: v.number(),
      decidedAt: v.optional(v.number()),
    }).index("by_status", ["status"]),

    // Member-submitted "printer" privilege requests (admin grants via the
    // Requests console or People page; admins implicitly have the privilege).
    printerRequests: defineTable({
      userId: v.id("users"),
      message: v.optional(v.string()),
      status: v.union(v.literal("pending"), v.literal("approved"), v.literal("denied")),
      requestedAt: v.number(),
      decidedAt: v.optional(v.number()),
    }).index("by_status", ["status"]),

    // ===== Chat module (local-first relay) =====
    // The database NEVER stores conversation logs. These tables hold only
    // ephemeral relay state: live messages are pulled by online recipients
    // and swept shortly after delivery, so the cloud DB stays clean and the
    // durable copy of every conversation lives in each user's IndexedDB.

    // A conversation: a 1-on-1 DM (two exact member ids) or a group chat.
    chatConversations: defineTable({
      kind: v.union(v.literal("dm"), v.literal("group")),
      // DMs: sorted pair "<minId>:<maxId>". Groups: undefined.
      dmKey: v.optional(v.string()),
      name: v.optional(v.string()), // group name (admin-set)
      image: v.optional(v.string()), // group avatar (data URL / URL)
      createdBy: v.optional(v.id("users")),
      memberIds: v.array(v.id("users")),
      // Project-linked groups sync automatically with project membership.
      projectId: v.optional(v.id("projects")),
      deleted: v.optional(v.boolean()),
      // Monotonic last-activity stamp, refreshed by the relay on every send.
      lastActivityAt: v.optional(v.number()),
    })
      .index("by_dmKey", ["dmKey"])
      .index("by_project", ["projectId"]),

    // Live relay messages. `deliveredTo` fills up as recipients pull them;
    // once every recipient has fetched a message it becomes sweepable.
    chatMessages: defineTable({
      conversationId: v.id("chatConversations"),
      senderId: v.id("users"),
      body: v.string(),
      // Attachment = a small data URL (images/docs under ~500 KB) stored on
      // the message itself so a single pull is enough; recipients persist it
      // locally and the relay row is swept afterwards.
      attachment: v.optional(
        v.object({
          name: v.string(),
          mime: v.string(),
          size: v.number(),
          dataUrl: v.string(),
        }),
      ),
      replyToId: v.optional(v.id("chatMessages")),
      editedAt: v.optional(v.number()),
      deletedForEveryone: v.optional(v.boolean()),
      clientTag: v.optional(v.string()), // dedupe key from the sender device
      deliveredTo: v.array(v.id("users")), // recipient acks
      readBy: v.array(v.id("users")), // read acks (blue ticks)
      // Per-user "delete for me" flags (userId → true). Relay-only.
      deletedForMe: v.optional(v.any()),
      createdAt: v.number(),
    })
      .index("by_conversation", ["conversationId"])
      .index("by_clientTag", ["clientTag"]),

    // Per-user chat state: typing status and last-seen (presence).
    chatPresence: defineTable({
      userId: v.id("users"),
      typingInConversationId: v.optional(v.id("chatConversations")),
      typingAt: v.optional(v.number()),
      lastSeenAt: v.optional(v.number()),
    }).index("by_user", ["userId"]),

    // ===== Fast sign-in ("remember this device") =====
    // A per-device secret issued right after a successful email-code sign-in.
    // The raw token lives ONLY in that device's localStorage; the database
    // stores its SHA-256 hash, so a database dump can never be replayed as a
    // login. Signing in with a saved token skips the email code entirely.
    deviceTokens: defineTable({
      userId: v.id("users"),
      tokenHash: v.string(),
      deviceName: v.optional(v.string()),
      createdAt: v.number(),
      lastUsedAt: v.optional(v.number()),
    })
      .index("by_tokenHash", ["tokenHash"])
      .index("by_user", ["userId"]),

    // ===== Rent-card PDF relay queue ========================================
    // Automated rent-card posts (approve / return / assign / package returns)
    // are rendered in a signed-in admin's browser — the EXACT same hi-fi card
    // component used by the manual "Send PDF to group" button — so the group
    // always receives the identical PDF with perfect Arabic. The mutation that
    // triggers the card inserts a queued job here; the RentCardRelay client
    // picks it up, rasterizes the card off-screen, and uploads the PDF bytes,
    // then a Node action relays it to Telegram.
    rentCardJobs: defineTable({
      card: v.object({
        rentalId: v.optional(v.string()),
        groupName: v.string(),
        tag: v.string(),
        holderName: v.string(),
        studentId: v.optional(v.string()),
        statusLabel: v.string(),
        requestedAt: v.optional(v.number()),
        decidedAt: v.optional(v.number()),
        pickedUpAt: v.optional(v.number()),
        returnedAt: v.optional(v.number()),
        conditionReport: v.optional(v.string()),
        projectName: v.optional(v.string()),
        // Package cards list every unit of the bundle on the card itself.
        extraUnits: v.optional(
          v.array(v.object({ tag: v.string(), groupName: v.string() })),
        ),
      }),
      caption: v.string(),
      status: v.union(
        v.literal("queued"),
        v.literal("sending"),
        v.literal("sent"),
        v.literal("skipped"),
      ),
      attempts: v.number(),
      createdAt: v.number(),
      updatedAt: v.optional(v.number()),
    })
      .index("by_status", ["status"])
      .index("by_created", ["createdAt"]),

    // ===== 3D Print farm ================================================
    // Printers are club machines with per-machine configuration (nozzle size,
    // build volume, energy draw, machine-hour rate for cost accounting).
    printers: defineTable({
      name: v.string(),
      // Machine type, e.g. "Bambu Lab P1S", "Ender 3 V3".
      model: v.optional(v.string()),
      status: v.union(
        v.literal("idle"),
        v.literal("printing"),
        v.literal("maintenance"),
        v.literal("offline"),
      ),
      // Build volume in cm: width x depth x height.
      buildVolumeCm: v.optional(
        v.object({ w: v.number(), d: v.number(), h: v.number() }),
      ),
      // Default nozzle diameter in mm (0.4 typical).
      nozzleMm: v.optional(v.number()),
      note: v.optional(v.string()),
      deleted: v.optional(v.boolean()),
    }).index("by_status", ["status"]),

    // Maintenance / incident log per printer (nozzle swap, bed leveling,
    // clog, broken part…). Failed print jobs also land here for the record.
    printerMaintenance: defineTable({
      printerId: v.id("printers"),
      // "routine" = planned upkeep; "repair" = something broke.
      kind: v.union(v.literal("routine"), v.literal("repair")),
      text: v.string(),
      byUserId: v.id("users"),
      at: v.number(),
    }).index("by_printer", ["printerId"]),

    // A filament spool: material, color, remaining weight. `remainingG` is
    // stored as a string (same convention as group measureStock) and every
    // job completion deducts from it; low-stock alerts go to the admin console.
    filaments: defineTable({
      brand: v.optional(v.string()),
      material: v.union(
        v.literal("PLA"),
        v.literal("PETG"),
        v.literal("ABS"),
        v.literal("TPU"),
        v.literal("ASA"),
        v.literal("PLA+"),
        v.literal("Other"),
      ),
      colorName: v.string(),
      colorHex: v.optional(v.string()),
      // Spool net weight in grams (the plastic only, without the spool core).
      weightG: v.number(),
      // Remaining material in grams (string to avoid float drift).
      remainingG: v.string(),
      // Link to the club inventory group that stocks this material (e.g. the
      // "PLA filament" weight-tracked group) so stock stays in one ledger.
      inventoryGroupId: v.optional(v.id("groups")),
      // The inventory unit this spool mirrors (created automatically when the
      // spool is linked to a weight group): print deductions update both the
      // spool's remainingG and the unit's amountRemaining.
      partId: v.optional(v.id("parts")),
      lowAtG: v.optional(v.number()), // warn below this remaining weight
      archived: v.optional(v.boolean()),
      createdAt: v.number(),
    }).index("by_archived", ["archived"]),

    // A print job: member submits a part, admin slices/schedules it onto a
    // printer, progress updates flow in, completion computes the real cost.
    printJobs: defineTable({
      requesterId: v.id("users"),
      name: v.string(),
      details: v.optional(v.string()),
      // Where the model file lives (club drive / /print-files/<name>).
      fileUrl: v.optional(v.string()),
      fileName: v.optional(v.string()),
      // Estimated (request) and actual (sliced) filament usage in grams.
      estWeightG: v.optional(v.number()),
      weightG: v.optional(v.number()),
      // Estimated (request) and actual (sliced) print duration in minutes.
      estMinutes: v.optional(v.number()),
      minutes: v.optional(v.number()),
      // Which spool the job draws from (set at scheduling).
      filamentId: v.optional(v.id("filaments")),
      // Printer assigned when scheduled onto the queue.
      printerId: v.optional(v.id("printers")),
      // Queue position among jobs on the same printer (lower = earlier).
      queuePos: v.optional(v.number()),
      status: v.union(
        v.literal("pending"), // waiting for review by admin or printer role
        v.literal("approved"), // approved, waiting for scheduling/pickup of the file
        v.literal("denied"), // reviewer declined the request
        v.literal("need_slicing"), // member asked for help slicing it
        v.literal("slicing"), // someone claimed the slicing task
        v.literal("queued"), // scheduled on a printer, waiting its turn
        v.literal("printing"),
        v.literal("done"), // finished AND archived for the record
        v.literal("failed"),
        v.literal("canceled"),
      ),
      priority: v.union(v.literal("normal"), v.literal("high")),
      // Slicing help flow: request note + who took it. `needSlicing` marks
      // requests that arrived without printable G-code and route approval to
      // the need_slicing stage instead of straight to scheduling.
      needSlicing: v.optional(v.boolean()),
      slicingNote: v.optional(v.string()),
      slicingBy: v.optional(v.id("users")),
      createdAt: v.number(),
      startedAt: v.optional(v.number()),
      finishedAt: v.optional(v.number()),
      // Who ran / completed the job on the farm.
      operatedBy: v.optional(v.id("users")),
      failureNote: v.optional(v.string()),
      // Approval flow: which admin/printer reviewed the request and why.
      approvedBy: v.optional(v.id("users")),
      denialNote: v.optional(v.string()),
      // "done" prints stay visible in the archive strip; admins may
      // soft-hide them from the history list entirely.
      archivedAt: v.optional(v.number()),
    })
      .index("by_status", ["status"])
      .index("by_printer", ["printerId"])
      .index("by_requester", ["requesterId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
