import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";

/** Create or edit a component group (the "card" for a type of part). */
export function GroupFormDialog({
  open,
  onOpenChange,
  group,
  defaults,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  group?: Doc<"groups"> | null;
  defaults?: { categoryId?: string; closetId?: string };
}) {
  const categories = useQuery(api.catalog.listCategories, open ? {} : "skip");
  const closets = useQuery(api.catalog.listClosets, open ? {} : "skip");
  const upsert = useMutation(api.catalog.upsertGroup);

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [closetId, setClosetId] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [description, setDescription] = useState("");
  const [datasheetUrl, setDatasheetUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [quantityTotal, setQuantityTotal] = useState("1");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(group?.name ?? "");
      setCategoryId(group?.categoryId ?? defaults?.categoryId ?? "");
      setClosetId(group?.closetId ?? defaults?.closetId ?? "");
      setBrand(group?.brand ?? "");
      setModel(group?.model ?? "");
      setDescription(group?.description ?? "");
      setDatasheetUrl(group?.datasheetUrl ?? "");
      setImageUrl(group?.imageUrl ?? "");
      setQuantityTotal(String(group?.quantityTotal ?? 1));
    }
  }, [open, group, defaults]);

  const submit = async () => {
    if (!name.trim() || !categoryId || !closetId) {
      toast.error("Name, category and closet are required");
      return;
    }
    setBusy(true);
    try {
      const id = await upsert({
        id: group?._id,
        name: name.trim(),
        categoryId: categoryId as any,
        closetId: closetId as any,
        brand: brand.trim() || undefined,
        model: model.trim() || undefined,
        description: description.trim() || undefined,
        datasheetUrl: datasheetUrl.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
        quantityTotal: Math.max(1, parseInt(quantityTotal, 10) || 1),
      });
      toast.success(group ? "Group updated" : "Group created");
      onOpenChange(false);
      if (!group) window.location.href = `/group/${id}`;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{group ? "Edit group" : "New group"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Arduino Uno" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {(categories ?? []).map((c) => (
                    <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Closet</Label>
              <Select value={closetId} onValueChange={setClosetId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {(closets ?? []).map((c) => (
                    <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Brand</Label>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Arduino" />
            </div>
            <div className="grid gap-2">
              <Label>Model</Label>
              <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="A000066" />
            </div>
          </div>
          {!group && (
            <div className="grid gap-2">
              <Label>How many units</Label>
              <Input
                type="number"
                min={1}
                value={quantityTotal}
                onChange={(e) => setQuantityTotal(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Each unit gets its own QR tag automatically (ARD-001, ARD-002, …).
              </p>
            </div>
          )}
          <div className="grid gap-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Short description for the card"
            />
          </div>
          <div className="grid gap-2">
            <Label>Datasheet URL</Label>
            <Input
              value={datasheetUrl}
              onChange={(e) => setDatasheetUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="grid gap-2">
            <Label>Image URL</Label>
            <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : group ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
