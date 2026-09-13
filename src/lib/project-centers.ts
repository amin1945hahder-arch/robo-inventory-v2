/** Shared metadata for the six project centers (Projects workspace UI). */

export const CENTERS = [
  "mechanical",
  "electrical",
  "inventory",
  "programming",
  "references",
  "students",
] as const;

export type CenterKey = (typeof CENTERS)[number];

export const CENTER_META: Record<
  CenterKey,
  { label: string; icon: string; color: string; blurb: string }
> = {
  mechanical: {
    label: "Mechanical",
    icon: "⚙️",
    color: "text-amber-400",
    blurb: "Chassis, drivetrain, CAD and fabrication",
  },
  electrical: {
    label: "Electrical",
    icon: "⚡",
    color: "text-yellow-400",
    blurb: "Wiring, power, sensors and PCBs",
  },
  inventory: {
    label: "Inventory",
    icon: "📦",
    color: "text-cyan-400",
    blurb: "Parts checked out to this project",
  },
  programming: {
    label: "Programming",
    icon: "💻",
    color: "text-violet-400",
    blurb: "Firmware, control code and testing",
  },
  references: {
    label: "References",
    icon: "📚",
    color: "text-emerald-400",
    blurb: "Datasheets, guides and pinned links",
  },
  students: {
    label: "Students",
    icon: "🎓",
    color: "text-pink-400",
    blurb: "Training tasks and team coordination",
  },
};

export const TASK_STATUSES = ["todo", "doing", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_META: Record<
  TaskStatus,
  { label: string; dot: string; badge: string }
> = {
  todo: { label: "To do", dot: "bg-muted-foreground/50", badge: "bg-muted text-muted-foreground" },
  doing: { label: "In progress", dot: "bg-sky-400", badge: "bg-sky-500/15 text-sky-400" },
  review: { label: "Review", dot: "bg-amber-400", badge: "bg-amber-500/15 text-amber-400" },
  done: { label: "Done", dot: "bg-emerald-400", badge: "bg-emerald-500/15 text-emerald-400" },
};

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_META: Record<Priority, { label: string; badge: string }> = {
  low: { label: "Low", badge: "bg-muted text-muted-foreground" },
  normal: { label: "Normal", badge: "bg-muted text-foreground" },
  high: { label: "High", badge: "bg-orange-500/15 text-orange-400" },
  urgent: { label: "Urgent", badge: "bg-red-500/15 text-red-400" },
};
