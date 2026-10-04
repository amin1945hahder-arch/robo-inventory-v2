import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import logo from "@/assets/logo.svg";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Box,
  Boxes,
  Camera,
  CheckCircle2,
  CloudOff,
  FileDown,
  FileUp,
  FolderKanban,
  LayoutDashboard,
  Mail,
  PackageSearch,
  QrCode,
  ScanLine,
  ShieldCheck,
  Users,
  WifiOff,
  Warehouse,
  Wrench,
} from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
};

const FEATURES = [
  {
    icon: ScanLine,
    title: "Point. Scan. Rented.",
    body: "Every shelf unit carries its own QR tag. Scan it in the lab and the rental request is one tap away — no forms, no hunting through spreadsheets.",
  },
  {
    icon: ShieldCheck,
    title: "Admin-approved flow",
    body: "Admin gets an email and dashboard notification for every request. Approve with one click, straight from the inbox.",
  },
  {
    icon: FolderKanban,
    title: "Project assemblies",
    body: "Assign parts to club builds where they stay checked out for good — until the project is dismantled and everything returns to the shelves.",
  },
  {
    icon: Wrench,
    title: "Condition tracking",
    body: "Returns open a quick condition check — working units go back to the shelf, broken ones to the repair pile with full history.",
  },
  {
    icon: Warehouse,
    title: "Storages & categories",
    body: "Even storages and categories get their own QR codes. Scan a storage door to see everything inside it, live.",
  },
  {
    icon: Mail,
    title: "Email that acts",
    body: "Decision links in every notification email mean approvals take seconds, whether you're at your desk or in the lab.",
  },
  {
    icon: WifiOff,
    title: "Works offline, instant",
    body: "The whole database is cached per member on first open. Pages keep working with zero signal; new writes from any user interrupt and refresh only what changed.",
  },
  {
    icon: Box,
    title: "Built-in 3D slicer",
    body: "Kiri:Moto runs embedded in the tab. Slice, preview and export job files without leaving the lab — on mobile or desktop.",
  },
  {
    icon: PackageSearch,
    title: "Package bundles",
    body: "Rent several units as one decided package — a single bundle card, statuses kept in sync, easy edits or cancel before it's approved.",
  },
];

const STEPS = [
  { n: "01", title: "Scan the tag", body: "Point your camera at the unit's QR label in the lab." },
  { n: "02", title: "Request it", body: "One tap sends a request with an optional note for the admin." },
  { n: "03", title: "Get approved", body: "Admin approves from the dashboard or email — you get an email too." },
  { n: "04", title: "Build & return", body: "Take it to your robot, then return it or assign it to your project." },
];

/** Every module the app offers, grouped by who uses it — the "everything"
 *  showcase: one glance at the whole platform before signing up. */
const MEMBER_MODULES = [
  {
    icon: LayoutDashboard,
    name: "Dashboard",
    body: "Live availability at a glance: what's rented, broken, on projects and what's waiting for approval.",
  },
  {
    icon: Boxes,
    name: "Inventory",
    body: "Search by name, brand or category — or just scan a shelf. Live stock, storages and categories.",
  },
  {
    icon: Warehouse,
    name: "Storages",
    body: "Every storage door and category has its own QR. Scan a door to see exactly what lives inside it.",
  },
  {
    icon: FolderKanban,
    name: "Projects",
    body: "Assign parts to club builds for the long haul — checked out until the project is dismantled.",
  },
  {
    icon: PackageSearch,
    name: "My rentals",
    body: "Bar of tabs for package bundles, active requests and history — one place for everything borrowed.",
  },
  {
    icon: Box,
    name: "3D printing",
    body: "Embedded slicer with printer, material and filament in view. Slice, preview, export and print.",
  },
];

const ADMIN_MODULES = [
  {
    icon: Bell,
    name: "Requests console",
    body: "Nine tabs — updates, pending, packages, pickups, active, projects, history, ranks and profiles — with unread bubbles.",
  },
  {
    icon: Users,
    name: "People & roles",
    body: "Ranks, printer and inventory permissions, review workflows. Everyone gets their exact level of access.",
  },
  {
    icon: FileUp,
    name: "Import CSV",
    body: "Batch load parts, storages, projects and more from a spreadsheet — no manual entry for the long tail.",
  },
  {
    icon: QrCode,
    name: "Print labels",
    body: "Design the QR label sheet: paper size, per-section labels and cut lines. Prints every page in one go.",
  },
  {
    icon: FileDown,
    name: "Export studio",
    body: "Turn filtered inventory into print sheets or CSV — real mm scale, whole rows, zero page clipping.",
  },
  {
    icon: BarChart3,
    name: "Reports",
    body: "What's out, what's due, what's broken. The numbers the club runs on, straight from the database.",
  },
];

const OFFLINE_POINTS = [
  {
    icon: Warehouse,
    title: "Full cache per member",
    body: "Every table is downloaded and stored locally on first open — the whole club's inventory, not just your own.",
  },
  {
    icon: CheckCircle2,
    title: "Interrupt-only refresh",
    body: "Your app never polls. When someone else writes, you get one notification and exactly what changed is merged in.",
  },
  {
    icon: WifiOff,
    title: "Offline login, always",
    body: "Sign in uses the session stored on your device, so the app opens and the cache syncs without a connection.",
  },
];

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen overflow-x-clip">
      {/* backdrop: the global cover (src/assets/cover.*) is rendered app-wide
          by CoverBackground in main.tsx — only the soft glows stay local. */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-125 w-200 -translate-x-1/2 rounded-full bg-primary/12 blur-3xl" />
      <div className="pointer-events-none absolute right-[-10%] top-1/3 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl" />

      {/* nav */}
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Link to="/" className="flex items-center gap-2.5">
          <img src={logo} alt="RoboShelf logo" className="size-9 rounded-lg" />
          <span className="text-lg font-bold tracking-tight">RoboShelf</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <a href="#features" className="transition-colors hover:text-foreground">Features</a>
          <a href="#modules" className="transition-colors hover:text-foreground">Everything</a>
          <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
          <a href="#roles" className="transition-colors hover:text-foreground">Roles</a>
        </nav>
        <div className="flex items-center gap-2">
          {isAuthenticated ? (
            <Button size="sm" onClick={() => navigate("/dashboard")}>
              Dashboard <ArrowRight className="size-4" />
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" className="hidden sm:inline-flex" onClick={() => navigate("/auth")}>
                Sign in
              </Button>
              <Button size="sm" onClick={() => navigate("/auth")}>
                Get started
              </Button>
            </>
          )}
        </div>
      </header>

      {/* hero */}
      <section id="hero" className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center px-6 pb-24 pt-16 text-center md:pt-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Badge variant="outline" className="gap-2 border-primary/40 bg-primary/10 px-3 py-1 text-primary">
            <Camera className="size-3.5" />
            QR-native inventory for the lab
          </Badge>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.08 }}
          className="mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl"
        >
          Every part accounted for.
          <span className="neon-text block">One scan away.</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.16 }}
          className="mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg"
        >
          RoboShelf is the robotics club's inventory autopilot — track component rentals, returns and
          project assemblies with QR codes, clear oversight, and email approvals that take seconds.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.24 }}
          className="mt-8 flex flex-col gap-3 sm:flex-row"
        >
          <Button size="lg" className="neon-glow gap-2" onClick={() => navigate("/auth")}>
            Enter the lab <ArrowRight className="size-4" />
          </Button>
          <Button size="lg" variant="outline" className="gap-2" onClick={() => navigate("/auth?returnTo=/rent-scan")}>
            <ScanLine className="size-4" /> Try a scan
          </Button>
        </motion.div>

        {/* Everything the app offers at a glance — one pass over the whole
            platform, so the page earns its "powerful" in the first screen. */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.32 }}
          className="mt-12 flex flex-wrap items-center justify-center gap-2"
        >
          {[
            ["Dashboard", LayoutDashboard],
            ["Inventory", Boxes],
            ["Storages", Warehouse],
            ["Projects", FolderKanban],
            ["My rentals", PackageSearch],
            ["3D printing", Box],
            ["Requests", Bell],
            ["People", Users],
            ["Import CSV", FileUp],
            ["Print labels", QrCode],
            ["Export", FileDown],
            ["Reports", BarChart3],
            ["Offline-first", WifiOff],
          ].map(([name, Icon]) => (
            <span
              key={name as string}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <Icon className="size-3.5" />
              {name as string}
            </span>
          ))}
        </motion.div>
      </section>

      {/* mock scan card */}
      <section className="relative z-10 mx-auto flex w-full max-w-xl flex-col items-center px-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 32, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.65, delay: 0.35 }}
          className="glass rounded-2xl p-6 text-left"
        >
          <div className="flex items-center gap-3 border-b border-border/60 pb-4">
            <div className="icon-glass flex size-11 items-center justify-center rounded-lg text-primary">
              <QrCode className="size-5" />
            </div>
            <div>
              <p className="font-mono text-xs text-muted-foreground">ARD-003 · scanned</p>
              <p className="text-sm font-semibold">Arduino Uno — unit 3</p>
            </div>
            <Badge variant="outline" className="ml-auto border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
              Available
            </Badge>
          </div>
          <div className="grid grid-cols-3 gap-3 pt-4 text-center text-xs">
            {[
              ["8", "units total"],
              ["3", "available now"],
              ["2", "on projects"],
            ].map(([v, l]) => (
              <div key={l} className="glass-3d rounded-lg border border-border/60 bg-background/40 px-3 py-3">
                <p className="text-lg font-bold tabular-nums">{v}</p>
                <p className="text-muted-foreground">{l}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2 glass-3d rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-xs text-primary">
            <CheckCircle2 className="size-4" />
            Request sent — Admin approved it in no time.
          </div>
        </motion.div>
      </section>

      {/* everything — every module the app offers, grouped by who it's for */}
      <section id="modules" className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-8">
        <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="mx-auto max-w-2xl text-center">
          <Badge variant="outline" className="w-fit gap-2 border-primary/40 bg-primary/10 px-3 text-primary">
            <Boxes className="size-3.5" />
            Everything the app offers
          </Badge>
          <h2 className="mt-3 text-3xl font-bold tracking-tight">
            One workspace, every lab workflow.
          </h2>
          <p className="mt-3 text-muted-foreground">
            From a single QR scan to a slicer job, from your desk to the lab and back again offline —
            RoboShelf covers the whole inventory story.
          </p>
        </motion.div>

        <p className="mt-12 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Member workspace
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MEMBER_MODULES.map(({ icon: Icon, name, body }, i) => (
            <motion.div
              key={name}
              {...fadeUp}
              transition={{ duration: 0.45, delay: i * 0.06 }}
              className="rounded-xl border border-border/80 bg-card/40 p-4"
            >
              <div className="icon-glass flex size-10 items-center justify-center rounded-lg text-primary">
                <Icon className="icon-3d size-5" />
              </div>
              <h3 className="mt-2 font-semibold tracking-tight">{name}</h3>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{body}</p>
            </motion.div>
          ))}
        </div>

        <p className="mt-10 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Admin console
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ADMIN_MODULES.map(({ icon: Icon, name, body }, i) => (
            <motion.div
              key={name}
              {...fadeUp}
              transition={{ duration: 0.45, delay: i * 0.06 }}
              className="rounded-xl border border-border/80 bg-card/40 p-4"
            >
              <div className="icon-glass flex size-10 items-center justify-center rounded-lg text-primary">
                <Icon className="icon-3d size-5" />
              </div>
              <h3 className="mt-2 font-semibold tracking-tight">{name}</h3>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* features */}
      <section id="features" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
        <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Built for makers, not spreadsheets</h2>
          <p className="mt-3 text-muted-foreground">
            Hardware lives in storages, parts go missing, projects hoard components. RoboShelf keeps
            the whole story straight.
          </p>
        </motion.div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }, i) => (
            <motion.div key={title} {...fadeUp} transition={{ duration: 0.45, delay: i * 0.06 }}>
              <Card className="h-full border-border/80">
                <CardContent className="flex flex-col gap-3 p-6">
                  <div className="icon-glass flex size-11 items-center justify-center rounded-lg text-primary">
                    <Icon className="icon-3d size-5" />
                  </div>
                  <h3 className="font-semibold tracking-tight">{title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{body}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* offline-first band — the database is local, the app works with zero
          signal, and only interrupts from other users ever touch the cache. */}
      <section className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-20">
        <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="mx-auto max-w-3xl text-center">
          <Badge variant="outline" className="w-fit gap-2 border-violet-500/40 bg-violet-500/10 px-3 text-violet-400">
            <CloudOff className="size-3.5" />
            Offline first
          </Badge>
          <h2 className="mt-3 text-3xl font-bold tracking-tight">The database is always on your side.</h2>
          <p className="mt-3 text-muted-foreground">
            The first time you open RoboShelf, the entire database for your club is synced and stored
            locally on your device. Every page reads from that cache — nothing waits on the network,
            and your tabs stay fast even with zero signal.
          </p>
          <p className="mt-2 text-muted-foreground">
            Updates only arrive as interrupts: when another member changes something, the app is
            notified and refreshes precisely what changed — nothing more. Open the app again and it
            pulls every change since you last visited. Even the login works offline, using the session
            already stored on your device, so you're never blocked by the network on the way in.
          </p>
        </motion.div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {OFFLINE_POINTS.map(({ icon: Icon, title, body }, i) => (
            <motion.div
              key={title}
              {...fadeUp}
              transition={{ duration: 0.45, delay: i * 0.06 }}
              className="rounded-xl border border-border/80 bg-card/40 p-6"
            >
              <div className="icon-glass flex size-10 items-center justify-center rounded-lg text-primary">
                <Icon className="icon-3d size-5" />
              </div>
              <h3 className="mt-2 font-semibold tracking-tight">{title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
        <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">From shelf to robot in four steps</h2>
        </motion.div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ n, title, body }, i) => (
            <motion.div
              key={n}
              {...fadeUp}
              transition={{ duration: 0.45, delay: i * 0.08 }}
              className="relative glass-3d rounded-xl border border-border/80 bg-card/40 p-6 backdrop-blur"
            >
              <p className="font-mono text-sm text-primary">{n}</p>
              <h3 className="mt-2 font-semibold tracking-tight">{title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* roles */}
      <section id="roles" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
        <div className="grid gap-4 md:grid-cols-2">
          <motion.div {...fadeUp} transition={{ duration: 0.5 }}>
            <Card className="h-full border-border/80">
              <CardContent className="flex flex-col gap-4 p-8">
                <Badge variant="outline" className="w-fit border-primary/40 text-primary">For members</Badge>
                <h3 className="text-xl font-semibold tracking-tight">Find it, request it, build it</h3>
                <ul className="flex flex-col gap-2.5 text-sm text-muted-foreground">
                  {[
                    "Search by name, brand or category — or just scan the shelf",
                    "See live availability: rented, broken, on projects",
                    "Track your active rentals in one place",
                    "Assign parts to your project for the long haul",
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /> {t}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>
          <motion.div {...fadeUp} transition={{ duration: 0.5, delay: 0.1 }}>
            <Card className="h-full border-border/80">
              <CardContent className="flex flex-col gap-4 p-8">
                <Badge variant="outline" className="w-fit border-violet-500/40 text-violet-400">For the admin</Badge>
                <h3 className="text-xl font-semibold tracking-tight">Total oversight, zero chasing</h3>
                <ul className="flex flex-col gap-2.5 text-sm text-muted-foreground">
                  {[
                    "Every request lands in the dashboard and your inbox",
                    "Approve or deny from email links — no login needed",
                    "Returns capture condition: works fine vs. needs repair",
                    "Full card per part: rent, available, broken, on projects",
                  ].map((t) => (
                    <li key={t} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-violet-400" /> {t}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-24">
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.5 }}
          className="neon-ring relative overflow-hidden glass-3d rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/12 via-card/60 to-violet-500/10 px-8 py-14 text-center"
        >
          <Boxes className="mx-auto size-10 text-primary" />
          <h2 className="mt-4 text-3xl font-bold tracking-tight">The lab is open</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Sign in with your club email and start scanning. Admins are set by email allow-list.
          </p>
          <Button size="lg" className="mt-6 gap-2" onClick={() => navigate("/auth")}>
            Sign in to RoboShelf <ArrowRight className="size-4" />
          </Button>
        </motion.div>
      </section>

      <footer className="relative z-10 border-t border-border/60 py-8">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 text-xs text-muted-foreground">
          <p>RoboShelf — Robotics Club Inventory</p>
          <p>Built for the lab 🤖</p>
        </div>
      </footer>
    </div>
  );
}