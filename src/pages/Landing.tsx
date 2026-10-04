import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AnimatePresence,
  MotionConfig,
  animate,
  motion,
  useInView,
  useMotionTemplate,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.svg";
import {
  ArrowRight,
  BarChart3,
  Battery,
  Bell,
  Bolt,
  Box,
  Boxes,
  Cable,
  Car,
  Camera,
  CheckCircle2,
  CircuitBoard,
  CloudOff,
  Cpu,
  FileDown,
  FileUp,
  FolderKanban,
  Gauge,
  Layers,
  LayoutDashboard,
  Mail,
  Package,
  PackageSearch,
  QrCode,
  Radio,
  ScanLine,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Warehouse,
  WifiOff,
  Wrench,
  Zap,
} from "lucide-react";

/* ══════════════════════════════════════════════════════════════════════
   Shared motion vocabulary — one place so every section moves with the
   same rhythm, and reduced-motion users get a still page via MotionConfig.
   ══════════════════════════════════════════════════════════════════════ */

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
};

const stagger = (i: number, step = 0.06) => ({
  duration: 0.5,
  delay: i * step,
  ease: [0.16, 1, 0.3, 1] as const,
});

/** A card that lights up around the cursor — the "it responds to you" cue. */
function SpotlightCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const mx = useMotionValue(-300);
  const my = useMotionValue(-300);
  const glow = useMotionTemplate`radial-gradient(260px circle at ${mx}px ${my}px, color-mix(in oklab, var(--primary) 15%, transparent), transparent 72%)`;

  return (
    <div
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        mx.set(e.clientX - box.left);
        my.set(e.clientY - box.top);
      }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border/70 bg-card/40 transition-colors duration-300 hover:border-primary/40",
        className,
      )}
    >
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: glow }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

/** Counts up once, when it scrolls into view. */
function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, to, {
      duration: 1.6,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setValue(v),
    });
    return () => controls.stop();
  }, [inView, to]);

  return (
    <span ref={ref} className="tabular-nums">
      {Math.round(value)}
      {suffix}
    </span>
  );
}

/** Endless ticker. The list is rendered twice so -50% loops seamlessly. */
function MarqueeRow({ items, reverse = false }: { items: string[]; reverse?: boolean }) {
  return (
    <div className="mask-fade-x flex overflow-hidden">
      <div
        className={cn(
          "flex w-max shrink-0 items-center gap-3 pr-3",
          reverse ? "animate-marquee-rev" : "animate-marquee",
        )}
      >
        {[...items, ...items].map((item, i) => (
          <span
            key={`${item}-${i}`}
            className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/50 px-4 py-2 text-sm whitespace-nowrap text-muted-foreground"
          >
            <Boxes className="size-4 text-primary" />
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Content — everything the app actually offers, in one page.
   ══════════════════════════════════════════════════════════════════════ */

const TICKER = [
  "Microcontrollers",
  "Motors & servos",
  "Sensors",
  "LiPo batteries",
  "3D-printed brackets",
  "Chassis kits",
  "Filament & resin",
  "Wire & connectors",
  "Gearboxes",
  "Driver boards",
  "Fasteners",
  "Test equipment",
];

const CATEGORY_GROUPS = [
  "All",
  "Electronics",
  "Motion",
  "Power",
  "Mechanical",
  "Fabrication",
  "Consumables",
] as const;

/** Example shelf from a working club — every row is a real category shape
 *  RoboShelf stores: a QR-coded group of units with a live availability. */
const CATEGORIES = [
  {
    icon: Cpu,
    name: "Microcontrollers",
    group: "Electronics",
    units: 34,
    blurb: "ESP32, RP2040, STM32 and the trusty Arduino — the brain of every build.",
  },
  {
    icon: Gauge,
    name: "Sensors & modules",
    group: "Electronics",
    units: 47,
    blurb: "Distance, IMU, temperature, light. The eyes and ears of a robot.",
  },
  {
    icon: Radio,
    name: "Comms & telemetry",
    group: "Electronics",
    units: 18,
    blurb: "nRF24, LoRa, ESP-NOW links and plain 433MHz — see the bot from the desk.",
  },
  {
    icon: CircuitBoard,
    name: "Driver boards",
    group: "Electronics",
    units: 21,
    blurb: "L298N, TB6612, motor HATs — everything that makes a pin strong enough.",
  },
  {
    icon: Bolt,
    name: "Motors & servos",
    group: "Motion",
    units: 52,
    blurb: "DC, steppers and servos, each unit tracked individually, never in a pile.",
  },
  {
    icon: Settings,
    name: "Gearboxes & pulleys",
    group: "Motion",
    units: 19,
    blurb: "Ratio changes without reprinting a single bracket.",
  },
  {
    icon: Battery,
    name: "Batteries & packs",
    group: "Power",
    units: 30,
    blurb: "LiPo packs, holders and chargers — with the cell count recorded.",
  },
  {
    icon: Zap,
    name: "Power distribution",
    group: "Power",
    units: 24,
    blurb: "Buck modules, fuses, switches and wiring that never goes missing.",
  },
  {
    icon: Car,
    name: "Chassis & drive",
    group: "Mechanical",
    units: 26,
    blurb: "Wheels, tracks, brackets and gearboxes for anything that rolls.",
  },
  {
    icon: Wrench,
    name: "Tools & fasteners",
    group: "Mechanical",
    units: 88,
    blurb: "Drivers, hex keys, bearings, spacers — the small stuff that stops builds.",
  },
  {
    icon: Layers,
    name: "Extrusions & plates",
    group: "Fabrication",
    units: 40,
    blurb: "Aluminium profiles, acrylic and printed plates, cut to the job.",
  },
  {
    icon: Cable,
    name: "Wire & connectors",
    group: "Fabrication",
    units: 60,
    blurb: "Hook-up wire, crimps and JST — measured by the metre, not by the guess.",
  },
  {
    icon: Package,
    name: "Filament & resin",
    group: "Consumables",
    units: 12,
    blurb: "PLA, PETG and resin with the printer that runs them — used up, not returned.",
  },
  {
    icon: Sparkles,
    name: "Adhesives & tapes",
    group: "Consumables",
    units: 16,
    blurb: "Consumables that decrement instead of waiting at a return desk.",
  },
];

const MEMBER_MODULES = [
  {
    icon: LayoutDashboard,
    name: "Dashboard",
    body: "Live availability at a glance: what's rented, broken, on projects and waiting for approval.",
  },
  {
    icon: Boxes,
    name: "Inventory",
    body: "Search by name, brand or category — or just scan a shelf. Live stock, storages, categories.",
  },
  {
    icon: Warehouse,
    name: "Storages",
    body: "Every storage door and category has its own QR. Scan a door to see exactly what lives inside.",
  },
  {
    icon: FolderKanban,
    name: "Projects",
    body: "Assign parts to club builds for the long haul — checked out until the project is dismantled.",
  },
  {
    icon: PackageSearch,
    name: "My rentals",
    body: "One tab bar for package bundles, active requests and history — everything borrowed, in one place.",
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
    body: "Eleven tabs — updates, pending, packages, pickups, active, projects, history, printers, ranks, profiles and the club readme — with unread bubbles.",
  },
  {
    icon: Users,
    name: "People & roles",
    body: "Ranks, printer and inventory permissions, review workflows. Everyone gets exactly their level of access.",
  },
  {
    icon: FileUp,
    name: "Import CSV",
    body: "Batch load parts, storages, projects and more from a spreadsheet — no manual entry for the long tail.",
  },
  {
    icon: QrCode,
    name: "Print labels",
    body: "Design the QR label sheet: paper size, per-section labels, cut lines. Every page prints in one go.",
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

const FEATURES = [
  {
    icon: ScanLine,
    title: "Point. Scan. Rented.",
    body: "Every shelf unit carries its own QR tag. Scan it in the lab and the rental request is one tap away — no forms, no hunting through spreadsheets.",
  },
  {
    icon: ShieldCheck,
    title: "Admin-approved flow",
    body: "Admin gets an email and a dashboard notification for every request. Approve with one click, straight from the inbox.",
  },
  {
    icon: FolderKanban,
    title: "Project assemblies",
    body: "Assign parts to club builds where they stay checked out for good — until the project is dismantled and everything returns to the shelves.",
  },
  {
    icon: Wrench,
    title: "Condition tracking",
    body: "Returns open a quick condition check — working units go back on the shelf, broken ones to the repair pile with their full history intact.",
  },
  {
    icon: Mail,
    title: "Email that acts",
    body: "Decision links in every notification email mean approvals take seconds, whether you're at your desk or halfway across the lab.",
  },
  {
    icon: PackageSearch,
    title: "Package bundles",
    body: "Rent several units as one decided package — a single bundle card, statuses kept in sync, easy to edit or cancel before approval.",
  },
];

const STEPS = [
  { n: "01", title: "Scan the tag", body: "Point your camera at the unit's QR label in the lab." },
  { n: "02", title: "Request it", body: "One tap sends the request, with an optional note for the admin." },
  { n: "03", title: "Get approved", body: "Admin approves from the dashboard or email — you get the email too." },
  { n: "04", title: "Build & return", body: "Take it to your robot, then return it or assign it to your project." },
];

const OFFLINE_POINTS = [
  {
    icon: Warehouse,
    title: "Full cache per member",
    body: "Every table is downloaded and stored locally on first open — the whole club's inventory, not just your own.",
  },
  {
    icon: CloudOff,
    title: "Interrupt-only refresh",
    body: "Your app never polls. When someone else writes, you get one notification and exactly what changed is merged in.",
  },
  {
    icon: WifiOff,
    title: "Offline login, always",
    body: "Sign-in uses the session already on your device, so the app opens and the cache loads without a connection.",
  },
];

const STATS = [
  { value: 21, suffix: "", label: "pages in the app", hint: "from scan to slicer" },
  { value: 100, suffix: "%", label: "of reads served locally", hint: "zero signal needed" },
  { value: 11, suffix: "", label: "request tabs to triage", hint: "one admin console" },
  { value: 1, suffix: " scan", label: "to start a rental", hint: "no forms" },
];

const ROLE_MEMBER = [
  "Search by name, brand or category — or just scan the shelf",
  "See live availability: rented, broken, on projects",
  "Track active rentals, packages and history in one tab bar",
  "Assign parts to your project for the long haul",
];

const ROLE_ADMIN = [
  "Every request lands in the dashboard and your inbox",
  "Approve or deny from email links — no login needed",
  "Returns capture condition: works fine vs. needs repair",
  "Full card per part: rent, available, broken, on projects",
];



export default function Landing() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-screen overflow-x-clip">
        <Aurora />
        <ScrollProgress />

        {/* ── nav ─────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-30">
          <Nav isAuthenticated={isAuthenticated} />
        </header>

        {/* ── hero ────────────────────────────────────────────────── */}
        <Hero onCta={() => navigate("/auth")} onScan={() => navigate("/auth?returnTo=/rent-scan")} />

        {/* ── ticker ──────────────────────────────────────────────── */}
        <section className="relative z-10 flex flex-col gap-3 border-y border-border/50 bg-background/30 py-6 backdrop-blur-sm">
          <p className="px-6 text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            What sits on a RoboShelf
          </p>
          <MarqueeRow items={TICKER} />
          <MarqueeRow items={[...TICKER].reverse()} reverse />
        </section>

        {/* ── stats ───────────────────────────────────────────────── */}
        <StatsBand />

        {/* ── categories (motion-heavy, filterable) ───────────────── */}
        <CategoryExplorer />

        {/* ── every module ────────────────────────────────────────── */}
        <ModulesSection />

        {/* ── features bento ──────────────────────────────────────── */}
        <FeaturesSection />

        {/* ── offline band ────────────────────────────────────────── */}
        <OfflineBand />

        {/* ── how it works ────────────────────────────────────────── */}
        <HowItWorks />

        {/* ── roles ───────────────────────────────────────────────── */}
        <RolesSection />

        {/* ── CTA ─────────────────────────────────────────────────── */}
        <CtaSection
          onPrimary={() => navigate("/auth")}
          label={isAuthenticated ? "Open the dashboard" : "Sign in to RoboShelf"}
        />

        <footer className="relative z-10 border-t border-border/60 py-8">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-6 text-xs text-muted-foreground sm:flex-row">
            <p>RoboShelf — Robotics Club Inventory</p>
            <p>Scan first. Spreadsheet never. 🤖</p>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Backdrop — drifting aurora over the app-wide cover, plus a scrolling
   grid. Pointer-events off so it never eats a click.
   ══════════════════════════════════════════════════════════════════════ */

function Aurora() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-160 overflow-hidden"
    >
      <div className="absolute -top-48 left-1/2 h-125 w-200 -translate-x-1/2 rounded-full bg-primary/12 blur-3xl animate-aurora" />
      <div className="absolute right-[-12%] top-1/4 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl animate-aurora [animation-delay:-6s]" />
      <div className="absolute left-[-10%] top-2/3 h-80 w-80 rounded-full bg-cyan-400/8 blur-3xl animate-aurora [animation-delay:-12s]" />
      <div className="animate-grid-pan grid-bg absolute inset-0 opacity-60 [mask-image:radial-gradient(70%_60%_at_50%_0%,#000_0%,transparent_100%)]" />
    </div>
  );
}

/** Thin neon progress line pinned under the nav — feedback for long page. */
function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 26, mass: 0.3 });

  return (
    <motion.div
      aria-hidden
      style={{ scaleX }}
      className="fixed inset-x-0 top-0 z-40 h-0.5 origin-left bg-gradient-to-r from-primary via-cyan-400 to-violet-500"
    />
  );
}

function Nav({ isAuthenticated }: { isAuthenticated: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    ["#categories", "Categories"],
    ["#features", "Features"],
    ["#modules", "Everything"],
    ["#how", "How it works"],
    ["#roles", "Roles"],
  ] as const;

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-4 transition-all duration-300",
        scrolled && "glass-strong rounded-2xl px-5 py-3 shadow-lg",
      )}
    >
      <Link to="/" className="flex items-center gap-2.5">
        <motion.img
          src={logo}
          alt="RoboShelf logo"
          className="size-9 rounded-lg"
          animate={{ rotate: [0, -6, 6, 0] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        />
        <span className="text-lg font-bold tracking-tight">RoboShelf</span>
      </Link>

      <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
        {links.map(([href, label]) => (
          <a key={href} href={href} className="group relative transition-colors hover:text-foreground">
            {label}
            <span className="absolute -bottom-1 left-0 h-px w-0 bg-primary transition-all duration-300 group-hover:w-full" />
          </a>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        {isAuthenticated ? (
          <Button size="sm" onClick={() => navigate("/dashboard")}>
            Dashboard <ArrowRight className="size-4" />
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="hidden sm:inline-flex"
              onClick={() => navigate("/auth")}
            >
              Sign in
            </Button>
            <Button size="sm" onClick={() => navigate("/auth")}>
              Get started
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Hero — words rise in sequence, the demo card tilts toward the cursor,
   and a live "available" pill breathes.
   ══════════════════════════════════════════════════════════════════════ */

function Hero({ onCta, onScan }: { onCta: () => void; onScan: () => void }) {
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 120, damping: 20 });
  const sy = useSpring(py, { stiffness: 120, damping: 20 });
  const rotateX = useTransform(sy, [-1, 1], [7, -7]);
  const rotateY = useTransform(sx, [-1, 1], [-9, 9]);

  const headline = ["Every", "part", "accounted", "for."];

  return (
    <section
      id="hero"
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        px.set((e.clientX - box.left) / box.width - 0.5);
        py.set((e.clientY - box.top) / box.height - 0.5);
      }}
      className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center px-6 pb-20 pt-14 text-center md:pt-24"
    >
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Badge
          variant="outline"
          className="gap-2 border-primary/40 bg-primary/10 px-3 py-1 text-primary"
        >
          <motion.span
            animate={{ scale: [1, 1.25, 1] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            className="flex"
          >
            <Camera className="size-3.5" />
          </motion.span>
          QR-native inventory for the lab
        </Badge>
      </motion.div>

      <h1 className="mt-6 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
        <span className="block">
          {headline.map((word, i) => (
            <motion.span
              key={word}
              className="inline-block"
              initial={{ opacity: 0, y: 26, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ ...stagger(i, 0.09), duration: 0.6 }}
            >
              {word}
              {i < headline.length - 1 ? " " : ""}
            </motion.span>
          ))}
          <motion.span
            className="neon-text block"
            initial={{ opacity: 0, y: 26, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ ...stagger(headline.length, 0.09), duration: 0.6 }}
          >
            One scan away.
          </motion.span>
        </span>
      </h1>

      <motion.p
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.3 }}
        className="mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg"
      >
        RoboShelf is the robotics club's inventory autopilot — rentals, returns,
        condition, project assemblies, labels, exports and a built-in 3D slicer,
        all driven by QR codes and all readable with no signal at all.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.4 }}
        className="mt-8 flex flex-col gap-3 sm:flex-row"
      >
        <Button size="lg" className="neon-glow press-3d gap-2" onClick={onCta}>
          Enter the lab <ArrowRight className="size-4" />
        </Button>
        <Button size="lg" variant="outline" className="press-3d gap-2" onClick={onScan}>
          <ScanLine className="size-4" /> Try a scan
        </Button>
      </motion.div>

      {/* Faux scanner: shows the payoff — a unit, its numbers, an approval. */}
      <motion.div
        style={{ rotateX, rotateY, transformPerspective: 1100 }}
        initial={{ opacity: 0, y: 40, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mt-14 w-full max-w-xl"
      >
        <div className="glass rounded-2xl p-6 text-left">
          <div className="flex items-center gap-3 border-b border-border/60 pb-4">
            <div className="icon-glass flex size-11 items-center justify-center rounded-lg text-primary">
              <motion.span
                animate={{ rotate: [0, 90, 180, 270, 360] }}
                transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
                className="flex"
              >
                <QrCode className="size-5" />
              </motion.span>
            </div>
            <div>
              <p className="font-mono text-xs text-muted-foreground">ARD-003 · scanned</p>
              <p className="text-sm font-semibold">Arduino Uno — unit 3</p>
            </div>
            <Badge
              variant="outline"
              className="relative ml-auto border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
            >
              <span className="absolute inset-0 -z-10 animate-ping-ring rounded-full border border-emerald-500/50" />
              Available
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-4 text-center text-xs">
            {[
              ["8", "units total"],
              ["3", "available now"],
              ["2", "on projects"],
            ].map(([v, l]) => (
              <div
                key={l}
                className="glass-3d lift-3d rounded-lg border border-border/60 bg-background/40 px-3 py-3"
              >
                <p className="text-lg font-bold tabular-nums">{v}</p>
                <p className="text-muted-foreground">{l}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2 overflow-hidden rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-xs text-primary">
            <CheckCircle2 className="size-4 shrink-0" />
            <span className="relative">
              Request sent — Admin approved it in no time.
              <span className="absolute inset-x-0 bottom-0 h-px origin-left bg-primary/40 animate-sweep" />
            </span>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Stats — product facts (module counts, offline reads), counting up.
   ══════════════════════════════════════════════════════════════════════ */

function StatsBand() {
  return (
    <section className="relative z-10 mx-auto w-full max-w-6xl px-6 py-14">
      <div className="glass grid gap-4 rounded-2xl p-6 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map(({ value, suffix, label, hint }, i) => (
          <motion.div key={label} {...fadeUp} transition={stagger(i)} className="text-center">
            <p className="text-4xl font-bold tracking-tight neon-text">
              <CountUp to={value} suffix={suffix} />
            </p>
            <p className="mt-1 text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Category explorer — the motion showpiece. Filter chips slide a shared
   underline (layoutId), the grid re-flows with AnimatePresence, and every
   card lights up under the cursor.
   ══════════════════════════════════════════════════════════════════════ */

function CategoryExplorer() {
  const [group, setGroup] = useState<(typeof CATEGORY_GROUPS)[number]>("All");
  const visible = useMemo(
    () => (group === "All" ? CATEGORIES : CATEGORIES.filter((c) => c.group === group)),
    [group],
  );

  return (
    <section id="categories" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
      <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="mx-auto max-w-2xl text-center">
        <Badge
          variant="outline"
          className="mx-auto w-fit gap-2 border-primary/40 bg-primary/10 px-3 text-primary"
        >
          <Camera className="size-3.5" />
          Every shelf, every category
        </Badge>
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          Your club's shelves, sorted and searchable.
        </h2>
        <p className="mt-3 text-muted-foreground">
          Categories aren't folders here — they're QR-coded, countable and live. Filter the way your
          club actually stores things.
        </p>
      </motion.div>

      <motion.div
        {...fadeUp}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="mt-8 flex flex-wrap items-center justify-center gap-2"
      >
        {CATEGORY_GROUPS.map((name) => {
          const active = group === name;
          return (
            <button
              key={name}
              type="button"
              onClick={() => setGroup(name)}
              className={cn(
                "relative rounded-full border border-border/70 bg-background/50 px-4 py-2 text-sm transition-colors",
                active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="category-pill"
                  className="absolute inset-0 rounded-full bg-primary"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <span className="relative z-10">{name}</span>
            </button>
          );
        })}
      </motion.div>

      <motion.div layout className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AnimatePresence mode="popLayout" initial={false}>
          {visible.map(({ icon: Icon, name, group: g, units, blurb }) => (
            <motion.div
              key={name}
              layout
              initial={{ opacity: 0, scale: 0.92, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: -8 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            >
              <SpotlightCard className="h-full">
                <div className="flex h-full flex-col p-5">
                  <div className="flex items-start justify-between">
                    <div className="icon-glass flex size-10 items-center justify-center rounded-lg text-primary">
                      <Icon className="icon-3d size-5" />
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">{g}</span>
                  </div>
                  <h3 className="mt-3 font-semibold tracking-tight">{name}</h3>
                  <p className="mt-1 flex-1 text-xs leading-5 text-muted-foreground">{blurb}</p>
                  <p className="mt-3 flex items-baseline gap-1.5 border-t border-border/60 pt-3">
                    <span className="text-xl font-bold tabular-nums text-primary">{units}</span>
                    <span className="text-xs text-muted-foreground">units tracked</span>
                  </p>
                </div>
              </SpotlightCard>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Sample shelf from a working club — categories are yours to define, and each one is QR-coded on
        its own label.
      </p>
    </section>
  );
}



/* ══════════════════════════════════════════════════════════════════════
   Modules — every page the app has, grouped by who uses it.
   ══════════════════════════════════════════════════════════════════════ */

function ModuleGrid({
  title,
  items,
  offset = 0,
}: {
  title: string;
  items: typeof MEMBER_MODULES;
  offset?: number;
}) {
  return (
    <>
      <motion.p
        {...fadeUp}
        transition={{ duration: 0.4 }}
        className="mt-12 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground"
      >
        {title}
      </motion.p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ icon: Icon, name, body }, i) => (
          <motion.div key={name} {...fadeUp} transition={stagger(i + offset, 0.05)}>
            <SpotlightCard className="h-full">
              <div className="flex h-full flex-col p-5">
                <div className="icon-glass flex size-10 items-center justify-center rounded-lg text-primary">
                  <Icon className="icon-3d size-5" />
                </div>
                <h3 className="mt-2.5 font-semibold tracking-tight">{name}</h3>
                <p className="mt-1.5 flex-1 text-xs leading-5 text-muted-foreground">{body}</p>
              </div>
            </SpotlightCard>
          </motion.div>
        ))}
      </div>
    </>
  );
}

function ModulesSection() {
  return (
    <section id="modules" className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-8">
      <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="mx-auto max-w-2xl text-center">
        <Badge
          variant="outline"
          className="mx-auto w-fit gap-2 border-primary/40 bg-primary/10 px-3 text-primary"
        >
          <Boxes className="size-3.5" />
          Everything the app offers
        </Badge>
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          One workspace, every lab workflow.
        </h2>
        <p className="mt-3 text-muted-foreground">
          From a single QR scan to a slicer job, from your desk to the lab and back again offline —
          RoboShelf covers the whole inventory story.
        </p>
      </motion.div>

      <ModuleGrid title="Member workspace" items={MEMBER_MODULES} />
      <ModuleGrid title="Admin console" items={ADMIN_MODULES} offset={6} />
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Features — bento: one wide promise card, then the supporting six.
   ══════════════════════════════════════════════════════════════════════ */

function FeaturesSection() {
  return (
    <section id="features" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
      <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Built for makers, not spreadsheets
        </h2>
        <p className="mt-3 text-muted-foreground">
          Hardware lives in storages, parts go missing, projects hoard components. RoboShelf keeps the
          whole story straight — and does it on your phone, in the lab, offline.
        </p>
      </motion.div>

      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="lg:col-span-2">
          <SpotlightCard className="h-full">
            <div className="flex h-full flex-col justify-between gap-6 p-8">
              <div>
                <div className="icon-glass flex size-12 items-center justify-center rounded-xl text-primary">
                  <ScanLine className="icon-3d size-6" />
                </div>
                <h3 className="mt-4 text-2xl font-bold tracking-tight">
                  Point. Scan. Rented.
                </h3>
                <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                  Every shelf unit carries its own QR tag. Scan it in the lab and the rental request is
                  one tap away — no forms, no hunting through a spreadsheet, no asking which drawer
                  it's in. The admin approves from their inbox; you're back on the bench in seconds.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {["Instant request", "Email approval", "Live availability", "Zero paperwork"].map(
                  (chip) => (
                    <span
                      key={chip}
                      className="rounded-full border border-border/60 bg-background/50 px-3 py-1.5 text-xs text-muted-foreground"
                    >
                      {chip}
                    </span>
                  ),
                )}
              </div>
            </div>
          </SpotlightCard>
        </motion.div>

        <motion.div {...fadeUp} transition={stagger(1)} className="flex">
          <SpotlightCard className="h-full w-full">
            <div className="flex h-full flex-col p-6">
              <div className="icon-glass flex size-11 items-center justify-center rounded-lg text-primary">
                <Box className="icon-3d size-5" />
              </div>
              <h3 className="mt-3 font-semibold tracking-tight">Built-in 3D slicer</h3>
              <p className="mt-1.5 flex-1 text-sm leading-6 text-muted-foreground">
                Kiri:Moto runs embedded in the 3D printing tab, with the printer, material and
                filament in view. Slice, preview and export job files without leaving the lab.
              </p>
              <div className="mt-4 flex items-center gap-1.5 text-xs text-primary">
                <motion.span
                  animate={{ opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                >
                  ●●●
                </motion.span>
                slicing in-browser
              </div>
            </div>
          </SpotlightCard>
        </motion.div>

        {FEATURES.map(({ icon: Icon, title, body }, i) => (
          <motion.div key={title} {...fadeUp} transition={stagger(i + 2, 0.05)}>
            <SpotlightCard className="h-full">
              <div className="flex h-full flex-col p-6">
                <div className="icon-glass flex size-11 items-center justify-center rounded-lg text-primary">
                  <Icon className="icon-3d size-5" />
                </div>
                <h3 className="mt-3 font-semibold tracking-tight">{title}</h3>
                <p className="mt-1.5 flex-1 text-sm leading-6 text-muted-foreground">{body}</p>
              </div>
            </SpotlightCard>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Offline band — the differentiator, with a live-looking sync visual.
   ══════════════════════════════════════════════════════════════════════ */

function OfflineBand() {
  return (
    <section className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-20">
      <motion.div
        {...fadeUp}
        transition={{ duration: 0.5 }}
        className="glass relative overflow-hidden rounded-2xl p-8 text-center sm:p-12"
      >
        <div
          aria-hidden
          className="absolute -right-16 -top-16 size-64 rounded-full bg-violet-500/12 blur-3xl animate-breathe"
        />
        <Badge
          variant="outline"
          className="mx-auto w-fit gap-2 border-violet-500/40 bg-violet-500/10 px-3 text-violet-400"
        >
          <CloudOff className="size-3.5" />
          Offline first
        </Badge>
        <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
          The database is always on your side.
        </h2>
        <p className="mx-auto mt-3 max-w-3xl text-muted-foreground">
          The first time you open RoboShelf, the entire database for your club is synced and stored
          locally on your device. Every page reads from that cache — nothing waits on the network, and
          your tabs stay fast even with zero signal.
        </p>
        <p className="mx-auto mt-2 max-w-3xl text-muted-foreground">
          Updates arrive only as interrupts: when another member changes something, the app is notified
          and refreshes precisely what changed. Open it again and it pulls everything since your last
          visit. Even sign-in works offline, using the session already on your device.
        </p>

        {/* device → cloud → device, with travelling pulses */}
        <div className="relative mx-auto mt-10 flex max-w-md items-center justify-center gap-3">
          <div className="icon-glass flex size-12 items-center justify-center rounded-xl text-primary">
            <Camera className="size-5" />
          </div>
          <div className="relative h-px flex-1 overflow-hidden bg-border">
            <motion.span
              className="absolute inset-y-0 w-8 rounded-full bg-primary/70"
              animate={{ x: ["-10%", "320%"] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            />
          </div>
          <div className="icon-glass flex size-12 items-center justify-center rounded-xl text-violet-400">
            <CloudOff className="size-5" />
          </div>
        </div>

        <div className="mt-10 grid gap-4 text-left sm:grid-cols-3">
          {OFFLINE_POINTS.map(({ icon: Icon, title, body }, i) => (
            <motion.div key={title} {...fadeUp} transition={stagger(i)}>
              <SpotlightCard className="h-full">
                <div className="flex h-full flex-col p-6">
                  <div className="icon-glass flex size-10 items-center justify-center rounded-lg text-primary">
                    <Icon className="icon-3d size-5" />
                  </div>
                  <h3 className="mt-2.5 font-semibold tracking-tight">{title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
                </div>
              </SpotlightCard>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   How it works — timeline whose spine fills as you scroll past it.
   ══════════════════════════════════════════════════════════════════════ */

function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.85", "end 0.55"],
  });
  const fill = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.4 });

  return (
    <section id="how" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
      <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          From shelf to robot in four steps
        </h2>
      </motion.div>

      <div ref={ref} className="relative mt-12">
        {/* spine */}
        <div className="absolute left-[19px] top-2 hidden h-[calc(100%-1rem)] w-px bg-border sm:block" />
        <motion.div
          style={{ scaleY: fill }}
          className="absolute left-[19px] top-2 hidden h-[calc(100%-1rem)] w-px origin-top bg-primary sm:block"
        />

        <div className="flex flex-col gap-6">
          {STEPS.map(({ n, title, body }, i) => (
            <motion.div
              key={n}
              {...fadeUp}
              transition={stagger(i, 0.1)}
              className="relative sm:pl-16"
            >
              <div className="icon-glass absolute left-0 top-0 hidden size-10 items-center justify-center rounded-full font-mono text-sm text-primary sm:flex">
                {n}
              </div>
              <SpotlightCard className="h-full">
                <div className="flex h-full items-start gap-4 p-6">
                  <span className="font-mono text-sm text-primary sm:hidden">{n}</span>
                  <div>
                    <h3 className="font-semibold tracking-tight">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
                  </div>
                </div>
              </SpotlightCard>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Roles
   ══════════════════════════════════════════════════════════════════════ */

function RolesSection() {
  return (
    <section id="roles" className="relative z-10 mx-auto w-full max-w-6xl px-6 py-20">
      <div className="grid gap-4 md:grid-cols-2">
        {(
          [
            {
              badge: "For members",
              badgeClass: "border-primary/40 text-primary",
              title: "Find it, request it, build it",
              points: ROLE_MEMBER,
              dot: "text-primary",
            },
            {
              badge: "For the admin",
              badgeClass: "border-violet-500/40 text-violet-400",
              title: "Total oversight, zero chasing",
              points: ROLE_ADMIN,
              dot: "text-violet-400",
            },
          ] as const
        ).map((role, i) => (
          <motion.div key={role.badge} {...fadeUp} transition={stagger(i, 0.1)}>
            <SpotlightCard className="h-full">
              <div className="flex h-full flex-col gap-4 p-8">
                <Badge variant="outline" className={cn("w-fit", role.badgeClass)}>
                  {role.badge}
                </Badge>
                <h3 className="text-xl font-semibold tracking-tight">{role.title}</h3>
                <ul className="flex flex-col gap-2.5 text-sm text-muted-foreground">
                  {role.points.map((t) => (
                    <li key={t} className="flex items-start gap-2">
                      <CheckCircle2 className={cn("mt-0.5 size-4 shrink-0", role.dot)} /> {t}
                    </li>
                  ))}
                </ul>
              </div>
            </SpotlightCard>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   CTA
   ══════════════════════════════════════════════════════════════════════ */

function CtaSection({ onPrimary, label }: { onPrimary: () => void; label: string }) {
  return (
    <section className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-24">
      <motion.div
        {...fadeUp}
        transition={{ duration: 0.5 }}
        className="neon-ring relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/12 via-card/60 to-violet-500/10 px-8 py-16 text-center"
      >
        <div className="relative mx-auto flex size-16 items-center justify-center">
          <span className="absolute inset-0 animate-ping-ring rounded-2xl border border-primary/50" />
          <Boxes className="size-8 text-primary" />
        </div>
        <h2 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">The lab is open</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Sign in with your club email and start scanning. Admins are set by email allow-list — and
          once you're in, the app keeps working even when the wifi doesn't.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button size="lg" className="neon-glow press-3d gap-2" onClick={onPrimary}>
            {label} <ArrowRight className="size-4" />
          </Button>
          <Button size="lg" variant="outline" className="press-3d gap-2" onClick={onPrimary}>
            <ScanLine className="size-4" /> Scan a unit
          </Button>
        </div>
      </motion.div>
    </section>
  );
}