import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, MessageCircle, Pencil, UserRound, IdCard } from "lucide-react";
import { PersonBadgeDialog } from "@/components/PersonBadgeDialog";

const fmt = (n?: number) => (n ? new Date(n).toLocaleString() : "—");

/** Person profile card — opened by scanning a person QR label (person:<id>). */
export default function PersonCard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const card = useQuery(api.users.getPersonCard, id ? { userId: id as any } : "skip");

  const openDm = useMutation(api.chat.openDm);
  const [dmBusy, setDmBusy] = useState(false);
  const [badgeOpen, setBadgeOpen] = useState(false);

  if (card === undefined) {
    return (
      <AppShell>
        <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </p>
      </AppShell>
    );
  }

  if (card === null || !card.person) {
    return (
      <AppShell>
        <div className="mx-auto mt-16 max-w-md rounded-lg border border-dashed p-8 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted/40">
            <UserRound className="size-6 text-muted-foreground" />
          </div>
          <p className="mt-3 text-sm font-medium">Person not found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This QR belongs to someone who is no longer in the club, or to a guest session.
          </p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/dashboard")}>
            Back to dashboard
          </Button>
        </div>
      </AppShell>
    );
  }

  const p = card.person;
  const viewerIsAdmin = card.viewerIsAdmin;
  const isSelf = card.isSelf;

  const startChat = async () => {
    setDmBusy(true);
    try {
      const convId = await openDm({ userId: p._id });
      navigate(`/chat?dm=${convId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setDmBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Member card</h1>
            <p className="mt-1 text-sm text-muted-foreground">Scanned person QR</p>
          </div>
          <Button variant="outline" onClick={() => navigate("/dashboard")}>
            Done
          </Button>
        </header>

        {/* Identity */}
        <section className="flex items-center gap-4 rounded-lg border p-5">
          <Avatar className="size-16 border">
            <AvatarImage src={p.image} />
            <AvatarFallback className="text-lg">
              {(p.name ?? p.email ?? "?").slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{p.name ?? "Unnamed member"}</p>
            <p className="truncate text-xs text-muted-foreground">{p.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {p.role === "admin" && (
                <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  Admin
                </span>
              )}
              {p.role === "student" && (
                <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
                  Student
                </span>
              )}
              {p.role === "member" && p.profileApproved === true && (
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                  Approved member
                </span>
              )}
              {p.membershipStatus === "ex" && (
                <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
                  Ex-member
                </span>
              )}
              {(p.clubRoles ?? []).map((r: string) => (
                <span
                  key={r}
                  className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary"
                >
                  {r}
                </span>
              ))}
              {p.academicState && (
                <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
                  {p.academicState}
                </span>
              )}
              {p.major && (
                <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
                  {p.major}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Details grid */}
        <section className="grid grid-cols-2 gap-3 text-sm">
          {p.studentId && (
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Student ID</p>
              <p className="mt-0.5 font-medium">{p.studentId}</p>
            </div>
          )}
          {p.studentCode && (
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Club code</p>
              <p className="mt-0.5 font-mono">{p.studentCode}</p>
            </div>
          )}
          {p.phone && (
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Phone</p>
              <p className="mt-0.5 font-medium">{p.phone}</p>
            </div>
          )}
          {p.telegramUsername && (
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Telegram</p>
              <p className="mt-0.5 font-medium">@{p.telegramUsername}</p>
            </div>
          )}
          {p.githubUrl && (
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">GitHub</p>
              <a
                href={p.githubUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-0.5 block truncate font-medium text-primary hover:underline"
              >
                {p.githubUrl.replace(/^https?:\/\/(www\.)?/, "")}
              </a>
            </div>
          )}
          {p.dateOfBirth && (
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Age</p>
              <p className="mt-0.5 font-medium">
                {Math.floor((Date.now() - new Date(p.dateOfBirth).getTime()) / 3.15576e10)} yrs
              </p>
            </div>
          )}
        </section>

        {/* Actions */}
        <section className="flex flex-wrap gap-2">
          {!isSelf && (
            <Button onClick={startChat} disabled={dmBusy}>
              {dmBusy ? <Loader2 className="size-4 animate-spin" /> : <MessageCircle className="size-4" />}
              Chat
            </Button>
          )}
          <Button variant="outline" onClick={() => setBadgeOpen(true)}>
            <IdCard className="size-4" /> Badge card
          </Button>
          {viewerIsAdmin && (
            <Button variant="outline" onClick={() => navigate("/people")}>
              <Pencil className="size-4" /> Edit in People
            </Button>
          )}
          {isSelf && (
            <Button variant="outline" onClick={() => navigate("/profile")}>
              Open my profile
            </Button>
          )}
        </section>

        {/* Rental history — self or admin only */}
        {card.canSeeHistory && (
          <section className="rounded-lg border">
            <div className="border-b px-5 py-3">
              <h2 className="text-sm font-semibold">Rental history</h2>
            </div>
            {card.rentals.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted-foreground">No rentals yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {card.rentals.map((r: any) => (
                  <li key={r._id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {r.groupName}{" "}
                        <span className="font-mono text-xs text-muted-foreground">({r.partTag})</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {fmt(r.requestedAt)}
                        {r.returnedAt ? ` · returned ${fmt(r.returnedAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.partId && (
                        <Link to={`/part/${r.partId}`} className="text-xs text-primary hover:underline">
                          Unit
                        </Link>
                      )}
                      <StatusBadge status={r.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {badgeOpen && (
          <PersonBadgeDialog
            p={{
              userId: p._id,
              name: p.name ?? "Member",
              email: p.email,
              image: p.image,
              role: p.role,
              studentId: p.studentId,
              clubRoles: p.clubRoles,
              academicState: p.academicState,
              major: p.major,
              phone: p.phone,
              telegramUsername: p.telegramUsername,
            }}
            onClose={() => setBadgeOpen(false)}
          />
        )}
      </div>
    </AppShell>
  );
}
