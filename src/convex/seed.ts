import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib";

export const seedInventory = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const seeded = await ctx.db
      .query("seedState")
      .withIndex("by_key", (q) => q.eq("key", "inventory"))
      .first();
    if (seeded) return { seeded: false };

    // closets
    const closetA = await ctx.db.insert("closets", { name: "Closet 1", location: "Lab A — Wall 1" });
    const closetB = await ctx.db.insert("closets", { name: "Closet 2", location: "Lab A — Wall 2" });
    const closetC = await ctx.db.insert("closets", { name: "Closet 3", location: "Lab B — Cabinet" });

    // categories
    const cBoards = await ctx.db.insert("categories", { name: "Boards" });
    const cSensors = await ctx.db.insert("categories", { name: "Sensors" });
    const cMotors = await ctx.db.insert("categories", { name: "Motors & Drivers" });
    const cKits = await ctx.db.insert("categories", { name: "Kits" });

    // groups + parts
    const mkGroup = async (
      name: string,
      categoryId: any,
      closetId: any,
      qty: number,
      extra: Record<string, any> = {},
    ) => {
      const groupId = await ctx.db.insert("groups", {
        name,
        categoryId,
        closetId,
        quantityTotal: qty,
        ...extra,
      });
      const prefix = name
        .replace(/[^A-Za-z0-9 ]/g, "")
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 3)
        .padEnd(3, "X");
      for (let i = 1; i <= qty; i++) {
        await ctx.db.insert("parts", {
          groupId,
          tag: `${prefix}-${String(i).padStart(3, "0")}`,
          status: "available",
        });
      }
      return groupId;
    };

    const gArduino = await mkGroup("Arduino Uno", cBoards, closetA, 8, {
      brand: "Arduino",
      model: "A000066",
      description: "ATmega328P microcontroller board, the club's workhorse for prototypes.",
    });
    const gEsp32 = await mkGroup("ESP32 DevKit", cBoards, closetA, 6, {
      brand: "Espressif",
      model: "ESP32-WROOM-32",
      description: "Wi-Fi + Bluetooth dual-core board for connected robots.",
    });
    const gRaspi = await mkGroup("Raspberry Pi 4", cBoards, closetA, 3, {
      brand: "Raspberry Pi",
      model: "4B 4GB",
      description: "Single-board computer for vision and autonomy stacks.",
    });
    const gUltrasonic = await mkGroup("HC-SR04 Ultrasonic", cSensors, closetB, 10, {
      brand: "Generic",
      description: "Distance sensor, 2–400 cm range.",
    });
    const gLine = await mkGroup("Line Follower Array", cSensors, closetB, 5, {
      description: "8-channel IR reflectance array for line following.",
    });
    const gL298 = await mkGroup("L298N Motor Driver", cMotors, closetB, 7, {
      brand: "ST",
      description: "Dual H-bridge driver for DC motors and steppers.",
    });
    const gServo = await mkGroup("SG90 Servo", cMotors, closetB, 12, {
      description: "9g micro servo for lightweight actuation.",
    });
    const gKit = await mkGroup("Starter Car Kit", cKits, closetC, 4, {
      description: "Chassis, wheels, drivers and wiring — everything for a first robot car.",
    });

    await mkGroup("N20 Gear Motor", cMotors, closetC, 9, {
      description: "Micro metal gear motor, 6V.",
    });

    // a demo project holding one Arduino unit
    const project = await ctx.db.insert("projects", {
      name: "Line Follower 2026",
      description: "Club competition robot for the national line follower race.",
      status: "active",
    });
    const projParts = await ctx.db
      .query("parts")
      .withIndex("by_group", (q) => q.eq("groupId", gArduino))
      .collect();
    if (projParts[0]) {
      await ctx.db.patch(projParts[0]._id, { status: "on_project", currentProjectId: project });
    }

    // mark a couple of broken units
    const broken = await ctx.db
      .query("parts")
      .withIndex("by_group", (q) => q.eq("groupId", gServo))
      .collect();
    if (broken[0]) await ctx.db.patch(broken[0]._id, { status: "broken", note: "Stripped gear" });
    if (broken[1]) await ctx.db.patch(broken[1]._id, { status: "broken", note: "Jammed potentiometer" });

    await ctx.db.insert("seedState", { key: "inventory" });
    return { seeded: true };
  },
});

export const isSeeded = query({
  args: {},
  handler: async (ctx) => {
    const seeded = await ctx.db
      .query("seedState")
      .withIndex("by_key", (q) => q.eq("key", "inventory"))
      .first();
    return Boolean(seeded);
  },
});
