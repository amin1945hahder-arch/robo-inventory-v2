import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Chat relay hygiene: every 5 minutes, delete messages every recipient has
// pulled (12h grace) or that no device ever pulled (48h dead letter), so the
// database never accumulates conversation logs.
crons.interval("sweep-chat-relay", { minutes: 5 }, internal.chat.sweep, {});

export default crons;
