import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { QrScanDialog } from "@/components/QrScanDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ArrowLeft,
  Barcode,
  Camera,
  Loader2,
  Package,
  ScanLine,
  Search,
} from "lucide-react";

/**
 * Contextual scan page: the page reacts to your situation.
 * - Student scanning an available unit  -> one-tap rental request form
 * - Student scanning a unit they hold   -> info + reminder that admin returns it
 * - Admin scanning a rented unit        -> full rental context + Return / Assign flow
 * - Admin scanning a pending unit       -> approve / deny inline
 * - Any tag/category/closet/project QR  -> smart redirect to the right page
 */
export default function RentScan() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";

  const [scanOpen, setScanOpen] = useState(true);
  const [manual, setManual] = useState("");
  const [payload, setPayload] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // resolve any scanned payload (unit / inv / cat / closet / proj)
  const resolved = useQuery(
    api.lookup.resolve,
    payload ? { payload } : "skip",
  );

  // when the payload is a unit, load the full part + rental context
  const unitId = resolved?.type === "unit" ? resolved.id : undefined;
  const partData = useQuery(api.parts.getPartWithRental, unitId ? { id: unitId } : "skip");
  const requestRental = useMutation(api.parts.requestRental);
  const decide = useMutation(api.parts.decideRental);
  const returnDirect = useMutation(api.parts.setPartStatusDirect);
  const assignProject = useMutation(api.parts.assignPartToProject);
  const projects = useQuery(api.projects.listProjects, { status: "active" });
  const [projectId, setProjectId] = useState("");

  const handleScan = (text: string) => {
    setScanOpen(false);
    setPayload(text.trim());
    setNote("");
  };

  const submitManual = () => {
    if (!manual.trim()) return;
    handleScan(manual.trim().toUpperCase());
  };

  const request = async () => {
    if (!partData?.part || !partData.group) return;
    setBusy(true);
    try {
      await requestRental({
        partId: partData.part._id,
        groupId: partData.group._id,
        note: note.trim() || undefined,
      });
      toast.success("Request sent — the lab admin has been notified");
      setPayload(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const decideRental = async (approve: boolean) => {
    const r = partData?.shownRental;
    if (!r) return;
    setBusy(true);
    try {
      await decide({ rentalId: r._id, approve });
      toast.success(approve ? "Approved — student can pick it up" : "Denied");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const doReturn = async (functional: boolean) => {
    if (!partData?.part) return;
    setBusy(true);
    try {
      await returnDirect({
        partId: partData.part._id,
        functional,
        conditionReport: note.trim() || undefined,
      });
      toast.success(functional ? "Returned to shelf" : "Marked broken and shelved");
      setNote("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const doAssign = async () => {
    if (!partData?.part || !projectId) return;
    setBusy(true);
    try {
      await assignProject({ partId: partData.part._id, projectId: projectId as any, functional: true });
      toast.success("Assigned to project — it stays checked out until dismantled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  // smart-redirect for non-unit payloads
  if (resolved && resolved.type !== "unit") {
    return (
      <AppShell>
        <div className="flex flex-col gap-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">Scanned code recognised</p>
          <Button className="mx-auto" onClick={() => navigate(resolved.url)}>
            Open {resolved.type}
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="size-4" /> Dashboard
          </Button>
          <p className="text-xs text-muted-foreground">
            {isAdmin ? "Admin scan mode" : "Member scan mode"}
          </p>
        </div>

        {!payload ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ScanLine className="size-7" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Scan a unit QR label</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isAdmin
                    ? "Scan a rented unit to process its return, or a pending one to approve."
                    : "Scan the tag on a shelf unit to request it, or any label to explore."}
                </p>
              </div>
              <Button className="gap-2" onClick={() => setScanOpen(true)}>
                <Camera className="size-4" /> Open camera
              </Button>
              <div className="flex w-full gap-2">
                <div className="relative flex-1">
                  <Barcode className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitManual()}
                    placeholder="…or type a tag like ARD-001"
                    className="pl-9 font-mono"
                  />
                </div>
                <Button variant="outline" onClick={submitManual}>
                  <Search className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : resolved === undefined ? (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Looking up {payload}…
          </p>
        ) : resolved === null ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
              <p className="text-sm font-medium">Nothing matched “{payload}”</p>
              <p className="text-xs text-muted-foreground">
                Try a unit tag (ARD-001), or scan another label.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setPayload(null)}>Scan again</Button>
                <Button variant="outline" asChild>
                  <Link to="/inventory">Browse inventory</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : partData === undefined || partData === null ? (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading unit…
          </p>
        ) : (
          <Card className="neon-ring overflow-hidden">
            <CardContent className="flex flex-col gap-5 p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-xs text-muted-foreground">{partData.part.tag}</p>
                  <h2 className="text-xl font-semibold tracking-tight">{partData.group?.name}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[partData.closet?.name, partData.category?.name].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <StatusBadge status={partData.part.status} />
              </div>

              {/* STUDENT: available -> request */}
              {partData.part.status === "available" && !isAdmin && (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">
                    This unit is on the shelf and available. Send a rental request to Dr. Essa.
                  </p>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional note — what's it for, how long do you need it?"
                    rows={2}
                  />
                  <Button onClick={request} disabled={busy}>
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <Package className="size-4" />}
                    {busy ? "Sending…" : "Request this unit"}
                  </Button>
                </div>
              )}

              {/* STUDENT: pending (own request) */}
              {partData.part.status === "pending" && partData.shownRental?.mine && (
                <p className="text-sm text-muted-foreground">
                  Your request is pending — you'll get an email once Dr. Essa decides.
                </p>
              )}

              {/* STUDENT: pending (someone else) */}
              {partData.part.status === "pending" && !partData.shownRental?.mine && !isAdmin && (
                <p className="text-sm text-muted-foreground">
                  A rental request for this unit is awaiting the admin's decision.
                </p>
              )}

              {/* STUDENT: rented by them */}
              {partData.part.status === "rented" && partData.shownRental?.mine && !isAdmin && (
                <p className="text-sm text-muted-foreground">
                  This unit is rented to you. Bring it back to the lab — the admin confirms the
                  return (shelf or a project) and logs its condition.
                </p>
              )}

              {/* STUDENT: rented by someone else */}
              {partData.part.status === "rented" && !partData.shownRental?.mine && !isAdmin && (
                <p className="text-sm text-muted-foreground">
                  Currently rented to {partData.shownRental?.holderName ?? "another member"}.
                </p>
              )}

              {/* on project / broken */}
              {partData.part.status === "on_project" && (
                <p className="text-sm text-muted-foreground">
                  Checked out to <b>{partData.shownRental?.projectName ?? "a project"}</b> until it is
                  dismantled.
                </p>
              )}
              {partData.part.status === "broken" && (
                <p className="text-sm text-muted-foreground">
                  Marked broken — waiting on repair. An admin can fix the status on the unit page.
                </p>
              )}

              {/* ADMIN: pending -> approve/deny */}
              {isAdmin && partData.part.status === "pending" && partData.shownRental && (
                <div className="flex flex-col gap-3">
                  <p className="text-sm">
                    <b>{partData.shownRental.holderName}</b> requested this unit
                    {partData.shownRental.note ? ` — “${partData.shownRental.note}”` : ""}.
                  </p>
                  <div className="flex gap-2">
                    <Button className="flex-1" onClick={() => decideRental(true)} disabled={busy}>
                      Approve
                    </Button>
                    <Button variant="outline" className="flex-1" onClick={() => decideRental(false)} disabled={busy}>
                      Deny
                    </Button>
                  </div>
                </div>
              )}

              {/* ADMIN: rented -> return / assign */}
              {isAdmin && partData.part.status === "rented" && (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">
                    Rented to <b>{partData.shownRental?.holderName ?? "a member"}</b>. Choose what
                    happens on return:
                  </p>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Condition notes (optional)"
                    rows={2}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={() => doReturn(true)} disabled={busy}>
                      Return to shelf ✓
                    </Button>
                    <Button variant="outline" onClick={() => doReturn(false)} disabled={busy}>
                      Broken / repair
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <select
                      className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                    >
                      <option value="">Assign to project…</option>
                      {(projects ?? []).map((p) => (
                        <option key={p._id} value={p._id}>{p.name}</option>
                      ))}
                    </select>
                    <Button variant="outline" onClick={doAssign} disabled={!projectId || busy}>
                      Assign
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/part/${partData.part._id}`)}
                  >
                    Open full unit page
                  </Button>
                </div>
              )}

              {isAdmin && partData.part.status === "available" && (
                <p className="text-sm text-muted-foreground">
                  On the shelf — nothing to process. Members can request this unit.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Button variant="ghost" size="sm" className="self-center" onClick={() => { setPayload(null); setScanOpen(true); }}>
          <ScanLine className="size-4" /> Scan another
        </Button>
      </div>

      <QrScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onResult={handleScan}
        hint={isAdmin ? "Scan a unit to approve or process its return." : "Scan a unit tag to request it."}
      />
    </AppShell>
  );
}
