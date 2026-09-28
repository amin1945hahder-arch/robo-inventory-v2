import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import logo from "@/assets/logo.svg";
import {
  ArrowRight,
  Boxes,
  Camera,
  CheckCircle2,
  FolderKanban,
  Mail,
  QrCode,
  ScanLine,
  ShieldCheck,
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
];

const STEPS = [
  { n: "01", title: "Scan the tag", body: "Point your camera at the unit's QR label in the lab." },
  { n: "02", title: "Request it", body: "One tap sends a request with an optional note for the admin." },
  { n: "03", title: "Get approved", body: "Admin approves from the dashboard or email — you get an email too." },
  { n: "04", title: "Build & return", body: "Take it to your robot, then return it or assign it to your project." },
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
      <section className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center px-6 pb-24 pt-16 text-center md:pt-24">
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

        {/* mock scan card */}
        <motion.div
          initial={{ opacity: 0, y: 32, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.65, delay: 0.35 }}
          className="glass mt-16 w-full max-w-xl rounded-2xl p-6 text-left"
        >
          <div className="flex items-center gap-3 border-b border-border/60 pb-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
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
              <div key={l} className="rounded-lg border border-border/60 bg-background/40 px-3 py-3">
                <p className="text-lg font-bold tabular-nums">{v}</p>
                <p className="text-muted-foreground">{l}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-xs text-primary">
            <CheckCircle2 className="size-4" />
            Request sent — Admin approved it in no time.
          </div>
        </motion.div>
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
              <Card className="h-full border-border/80 bg-card/60 shadow-none backdrop-blur transition-colors hover:border-primary/40">
                <CardContent className="flex flex-col gap-3 p-6">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/12 text-primary">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="font-semibold tracking-tight">{title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{body}</p>
                </CardContent>
              </Card>
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
              className="relative rounded-xl border border-border/80 bg-card/40 p-6 backdrop-blur"
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
            <Card className="h-full border-border/80 bg-card/60 shadow-none">
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
            <Card className="h-full border-border/80 bg-card/60 shadow-none">
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
          className="neon-ring relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/12 via-card/60 to-violet-500/10 px-8 py-14 text-center"
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
