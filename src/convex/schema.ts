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

      // Real club positions (e.g. رئيس نادي الروبوت, منسق النادي, عضو علمي …)
      clubRoles: v.optional(v.array(v.string())),
      academicState: v.optional(v.string()),
      major: v.optional(v.string()),
      studentCode: v.optional(v.string()), // e.g. STU-0002 (reference sheet ID)
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

    rentals: defineTable({
      partId: v.id("parts"),
      userId: v.id("users"),
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

    profileRequests: defineTable({
      userId: v.id("users"),
      payload: v.object({
        name: v.optional(v.string()),
        studentId: v.optional(v.string()),
        phone: v.optional(v.string()),
      }),
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
