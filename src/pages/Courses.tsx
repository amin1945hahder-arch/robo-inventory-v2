import { GraduationCap, BookOpen, ClipboardList } from "lucide-react";
import { AppShell } from "@/components/AppShell";

/**
 * Courses — module placeholder.
 *
 * A clean, modular landing for the future Courses feature. Route protection
 * matches the app's RBAC: students are blocked from protected modules, so
 * this page is only reachable by admins and members (adjust when courses get
 * their own access rules).
 */
export default function Courses() {
  const modules = [
    {
      icon: BookOpen,
      title: "Course catalog",
      body: "Structured learning paths, lab sessions and workshop archives will live here.",
    },
    {
      icon: ClipboardList,
      title: "Assignments",
      body: "Practical build assignments tied to club hardware and rental flows.",
    },
    {
      icon: GraduationCap,
      title: "Certifications",
      body: "Skill badges and progress tracking for active members.",
    },
  ];

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <header>
          <p className="text-sm text-muted-foreground">Learning hub</p>
          <h1 className="text-3xl font-bold tracking-tight">Courses</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            A modular home for the club's future curriculum. Each module below is a
            placeholder ready for feature expansion.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="glass-3d rounded-xl border border-border/80 bg-card/60 p-6 backdrop-blur transition-colors hover:border-primary/40"
            >
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary neon-ring">
                <Icon className="size-5" />
              </div>
              <h2 className="mt-4 text-sm font-semibold">{title}</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
              <p className="mt-4 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                Coming soon
              </p>
            </div>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
