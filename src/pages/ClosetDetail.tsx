import { Link, useNavigate, useParams } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { GroupCard } from "@/components/GroupCard";
import { QrChip } from "@/components/QrChip";
import { Button } from "@/components/ui/button";
import { closetQr } from "@/lib/qr";
import { ArrowLeft, Warehouse } from "lucide-react";

export default function ClosetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const closet = useQuery(api.catalog.getCloset, id ? { id: id as any } : "skip");
  const groups = useQuery(api.catalog.listGroups, id ? { closetId: id as any } : "skip");
  const stats = useQuery(api.stats.groupStats, {});

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/closets")}>
            <ArrowLeft className="size-4" /> Closets
          </Button>
        </div>

        {closet === undefined ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>
        ) : closet === null ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Closet not found.</p>
        ) : (
          <>
            <header className="flex items-start gap-3 border-b pb-6">
              <QrChip payload={closetQr(closet._id)} label={closet.name} />
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{closet.name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {closet.location ?? "Lab storage"}
                  {closet.note ? ` · ${closet.note}` : ""}
                </p>
              </div>
            </header>

            {groups === undefined ? (
              <p className="text-sm text-muted-foreground">Loading groups…</p>
            ) : groups.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center">
                <Warehouse className="size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No component groups in this closet yet.</p>
              </div>
            ) : (
              <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {groups.map((g) => (
                  <GroupCard
                    key={g._id}
                    group={g}
                    stats={stats?.[g._id]}
                    isAdmin={false}
                  />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
