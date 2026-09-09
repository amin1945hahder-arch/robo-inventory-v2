import { useState } from "react";
import { useQuery } from "convex/react";
import QRCode from "react-qr-code";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { categoryQr, closetQr, groupQr, projectQr, qrUrl, unitQr } from "@/lib/qr";
import { Printer, Loader2 } from "lucide-react";

function Label({ value, title, sub }: { value: string; title: string; sub?: string }) {
  return (
    <div className="print-label flex items-center gap-3 rounded-md border bg-white p-3 text-black">
      <div className="shrink-0">
        <QRCode value={qrUrl(value)} size={64} />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-tight">{title}</p>
        {sub && <p className="truncate font-mono text-[11px] text-neutral-500">{sub}</p>}
        <p className="truncate font-mono text-[10px] text-neutral-400">{value}</p>
      </div>
    </div>
  );
}

export default function Labels() {
  const data = useQuery(api.labels.getLabelData, {});
  const [section, setSection] = useState<"all" | "closets" | "categories" | "projects" | "groups" | "units">("all");

  const filterSection = (
    key: "all" | "closets" | "categories" | "projects" | "groups" | "units",
  ) => (section === "all" ? true : section === key);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Print QR labels</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every closet, category, project, group and individual unit has its own QR — print a
              sheet and stick the labels on doors, shelves, bins and parts.
            </p>
          </div>
          <Button onClick={() => window.print()}>
            <Printer className="size-4" /> Print sheet
          </Button>
        </header>

        {/* section picker (not printed) */}
        <div className="no-print flex flex-wrap gap-2">
          {(
            [
              ["all", "Everything"],
              ["closets", "Closets"],
              ["categories", "Categories"],
              ["projects", "Projects"],
              ["groups", "Groups"],
              ["units", "Units"],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={section === key ? "default" : "outline"}
              onClick={() => setSection(key)}
            >
              {label}
            </Button>
          ))}
        </div>

        {data === undefined ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline size-4 animate-spin" /> Loading labels…
          </p>
        ) : (
          <div id="print-area" className="flex flex-col gap-8">
            {filterSection("closets") && data.closets.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold">Closets</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.closets.map((c) => (
                    <Label
                      key={c._id}
                      value={closetQr(c._id)}
                      title={c.name}
                      sub={c.location ?? undefined}
                    />
                  ))}
                </div>
              </section>
            )}

            {filterSection("categories") && data.categories.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold">Categories</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.categories.map((c) => (
                    <Label key={c._id} value={categoryQr(c.name)} title={c.name} />
                  ))}
                </div>
              </section>
            )}

            {filterSection("projects") && data.projects.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold">Projects</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.projects.map((p) => (
                    <Label key={p._id} value={projectQr(p._id)} title={p.name} />
                  ))}
                </div>
              </section>
            )}

            {filterSection("groups") && data.groups.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold">Groups</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.groups.map(({ group }) => (
                    <Label key={group._id} value={groupQr(group.name)} title={group.name} />
                  ))}
                </div>
              </section>
            )}

            {filterSection("units") && (
              <section>
                <h2 className="mb-3 text-sm font-semibold">Individual units</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {data.groups.flatMap(({ group, parts }) =>
                    parts.map((p) => (
                      <Label
                        key={p._id}
                        value={unitQr(p.tag)}
                        title={p.tag}
                        sub={group.name}
                      />
                    )),
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}