import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
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
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // ===== Robotics Club Inventory =====

    closets: defineTable({
      name: v.string(),
      location: v.optional(v.string()),
      note: v.optional(v.string()),
    })
      .index("by_name", ["name"]),

    categories: defineTable({
      name: v.string(),
      description: v.optional(v.string()),
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
      ),
      note: v.optional(v.string()),
      // Optional per-unit photo (URL) shown next to the unit's QR chip and on
      // rent cards; falls back to the group image when not set.
      imageUrl: v.optional(v.string()),
      currentHolderId: v.optional(v.id("users")),
      currentProjectId: v.optional(v.id("projects")),
      deleted: v.optional(v.boolean()),
    })
      .index("by_group", ["groupId"])
      .index("by_tag", ["tag"]),

    projects: defineTable({
      name: v.string(),
      description: v.optional(v.string()),
      status: v.union(
        v.literal("active"),
        v.literal("completed"),
        v.literal("dismantled"),
      ),
      ownerId: v.optional(v.id("users")),
      deleted: v.optional(v.boolean()),
    }).index("by_status", ["status"]),

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
      // Timestamp of the member's most recent package-level return request.
      returnRequestedAt: v.optional(v.number()),
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
        v.literal("active"),
        v.literal("on_project"),
        v.literal("returned"),
        v.literal("denied"),
        v.literal("canceled"),
      ),
      requestedAt: v.number(),
      decidedAt: v.optional(v.number()),
      pickedUpAt: v.optional(v.number()),
      returnedAt: v.optional(v.number()),
      projectId: v.optional(v.id("projects")),
      returnDestination: v.optional(
        v.union(v.literal("shelf"), v.literal("project")),
      ),
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

    settings: defineTable({
      key: v.string(),
      value: v.optional(v.string()),
    }).index("by_key", ["key"]),
    // settings keys used by the app:
    //  - "telegram"                        { botToken, clubGroupChatId, notificationsOn }
    //  - "return_request_cooldown_hours"   number as JSON string
    //  - "notification_sounds"             { enabled, per-process sound specs }

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
    rankRequests: defineTable({
      userId: v.id("users"),
      requestedRoles: v.array(v.string()),
      message: v.optional(v.string()),
      status: v.union(v.literal("pending"), v.literal("approved"), v.literal("denied")),
      requestedAt: v.number(),
      decidedAt: v.optional(v.number()),
    }).index("by_status", ["status"]),

    seedState: defineTable({
      key: v.string(),
    }).index("by_key", ["key"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
