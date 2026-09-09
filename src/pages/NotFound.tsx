import { motion } from "framer-motion";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Wrench } from "lucide-react";

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="grid-bg relative flex min-h-screen flex-col items-center justify-center px-6 text-center"
    >
      <div className="pointer-events-none absolute inset-0" />
      <div className="flex flex-col items-center gap-4">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/12 text-primary neon-ring">
          <Wrench className="size-7" />
        </div>
        <p className="font-mono text-sm tracking-widest text-muted-foreground">404</p>
        <h1 className="text-3xl font-bold tracking-tight">This part isn't on the shelf</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The page you're looking for doesn't exist. Maybe it was moved, dismantled, or never
          scanned in.
        </p>
        <div className="flex gap-2">
          <Button asChild>
            <Link to="/">Go to landing</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/inventory">Browse inventory</Link>
          </Button>
        </div>
      </div>
    </motion.div>
  );
}