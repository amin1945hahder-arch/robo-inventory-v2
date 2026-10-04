import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Chat module removed — no relay sweep needed.

// Pickup reminders: approved rentals with a scheduled pick-up get a Telegram
// nudge ~24h before and again ~1h before (each fires once).
crons.interval("pickup-reminders", { minutes: 15 }, internal.parts.pickupReminders, {});

// Bot auto-linking: every minute, read the club bot's pending Telegram
// updates and pair a member's chat id once they message the bot (after
// setting their @username in the profile).
crons.interval("telegram-poll-updates", { minutes: 5 }, internal.telegram.pollUpdates, {});

// Rent-card relay hygiene: reclaim stuck renders and prune finished jobs.
crons.interval("rent-card-relay-sweep", { minutes: 5 }, internal.rentCardRelay.sweep, {});

// Print-farm watchdog: flag jobs running 50% past their estimated duration.
crons.interval("print-overdue-sweep", { minutes: 15 }, internal.printing.sweepOverduePrints, {});

// Scheduled full-data backup: hourly sweep fires the backup on the admin-set
// day of the month and posts the .zip into the chosen APP-group topic.
crons.interval("data-backup-sweep", { minutes: 60 }, internal.appBackup.sweep, {});

// Delta-sync hygiene: drop tombstones older than the retention window so
// per-table delta pulls and the tombstone index stay bounded (this was defined
// but never scheduled, so tombstones grew unbounded).
crons.interval("prune-sync-tombstones", { hours: 24 * 7 }, internal.sync.pruneTombstones, {});

export default crons;
