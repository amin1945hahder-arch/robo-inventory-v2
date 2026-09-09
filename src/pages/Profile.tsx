import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { LogOut, Send } from "lucide-react";

export default function Profile() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const requestChange = useMutation(api.notifications.requestProfileChange);
  const hasPendingRequest = useQuery(api.notifications.myPendingProfileRequest, {});
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name ?? "");
      setStudentId(user.studentId ?? "");
      setPhone(user.phone ?? "");
    }
  }, [user]);

  const pendingMine = hasPendingRequest === true;

  const submit = async () => {
    setBusy(true);
    try {
      await requestChange({
        name: name.trim() || undefined,
        studentId: studentId.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      toast.success("Change request sent to the admin for approval");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {user?.email} · signed in as {user?.role === "admin" ? "admin" : "member"}
          </p>
        </header>

        <section className="flex flex-col gap-4 rounded-lg border p-5">
          <div className="grid gap-2">
            <Label>Full name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Student ID</Label>
              <Input value={studentId} onChange={(e) => setStudentId(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          {pendingMine ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <StatusBadge status="pending" /> change awaiting admin approval
            </div>
          ) : (
            <Button onClick={submit} disabled={busy} className="self-start">
              <Send className="size-4" /> Request changes
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Profile edits are reviewed by the lab admin before they are applied.
          </p>
        </section>

        <Button
          variant="outline"
          className="self-start text-destructive"
          onClick={async () => {
            await signOut();
            navigate("/");
          }}
        >
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>
    </AppShell>
  );
}
