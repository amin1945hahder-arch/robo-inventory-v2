import { useEffect, useState } from "react";
import { LoadingGifInline } from "@/components/LoadingGif";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { asMessage } from "@/components/EditRentalDialog";
import { Loader2 } from "lucide-react";

/**
 * Multi-group editor for the inventory multi-select. Every field starts
 * "(unchanged)" — only ticked fields are applied to all selected groups, so
 * nothing is overwritten by accident. Handles category, storage, container,
 * brand/model and image links in one shot.
 */
export function BulkGroupDialog({
  open,
  onOpenChange,
  groupIds,
  categories,
  closets,
  allGroups,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groupIds: string[];
  categories: Doc<"categories">[] | undefined;
  closets: Doc<"closets">[] | undefined;
  allGroups: Doc<"groups">[] | undefined;
}) {
  const bulkUpdate = useMutation(api.catalog.bulkUpdateGroups);
  const [applyCategory, setApplyCategory] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [applyCloset, setApplyCloset] = useState(false);
  const [closetId, setClosetId] = useState("");
  const [applyContainer, setApplyContainer] = useState(false);
  const [parentId, setParentId] = useState("");
  const [applyBrand, setApplyBrand] = useState(false);
  const [brand, setBrand] = useState("");
  const [applyModel, setApplyModel] = useState(false);
  const [model, setModel] = useState("");
  const [applyImage, setApplyImage] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setApplyCategory(false);
      setCategoryId("");
      setApplyCloset(false);
      setClosetId("");
      setApplyContainer(false);
      setParentId("");
      setApplyBrand(false);
      setBrand("");
      setApplyModel(false);
      setModel("");
      setApplyImage(false);
      setImageUrl("");
    }
  }, [open]);

  const submit = async () => {
    if (groupIds.length === 0) return;
    setBusy(true);
    try {
      const res = await bulkUpdate({
        groupIds: groupIds as any,
        ...(applyCategory && categoryId ? { categoryId: categoryId as any } : {}),
        ...(applyCloset && closetId ? { closetId: closetId as any } : {}),
        ...(applyContainer ? { parentGroupId: (parentId || null) as any } : {}),
        ...(applyBrand ? { brand } : {}),
        ...(applyModel ? { model } : {}),
        ...(applyImage ? { imageUrl } : {}),
      });
      toast.success(
        `${groupIds.length} group(s) updated${res.moved > 0 ? ` · ${res.moved} moved into their container` : ""}`,
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(asMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const field = (
    checked: boolean,
    setChecked: (v: boolean) => void,
    label: string,
    control: React.ReactNode,
    hint?: string,
  ) => (
    <div className="flex items-start gap-2">
      <Checkbox checked={checked} onCheckedChange={(v) => setChecked(Boolean(v))} className="mt-1" />
      <div className="grid flex-1 gap-2">
        <Label className={checked ? "" : "text-muted-foreground"}>{label}</Label>
        {control}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {groupIds.length} group(s)</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          <p className="text-xs text-muted-foreground">
            Only the fields you tick are applied — everything else stays as-is on
            each group. Names and QR codes are never touched.
          </p>
          {field(
            applyCategory,
            setApplyCategory,
            "Category",
            <Select value={categoryId || "none"} onValueChange={(v) => setCategoryId(v === "none" ? "" : v)} disabled={!applyCategory}>
              <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Pick a category —</SelectItem>
                {(categories ?? []).map((c) => (
                  <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>,
          )}
          {field(
            applyCloset,
            setApplyCloset,
            "Storage",
            <Select value={closetId || "none"} onValueChange={(v) => setClosetId(v === "none" ? "" : v)} disabled={!applyCloset}>
              <SelectTrigger><SelectValue placeholder="Storage" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Pick a storage —</SelectItem>
                {(closets ?? []).map((c) => (
                  <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>,
          )}
          {field(
            applyContainer,
            setApplyContainer,
            "Container (group of groups)",
            <Select value={parentId || "none"} onValueChange={(v) => setParentId(v === "none" ? "" : v)} disabled={!applyContainer}>
              <SelectTrigger><SelectValue placeholder="Container" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not inside anything (top level)</SelectItem>
                {(allGroups ?? [])
                  .filter((g) => !groupIds.includes(g._id))
                  .filter((g) => !g.measure || g.measure === "count")
                  .map((g) => (
                    <SelectItem key={g._id} value={g._id}>{g.name}</SelectItem>
                  ))}
              </SelectContent>
            </Select>,
            "Puts all selected groups inside one master container (a box). Their cards move off the inventory grid onto the container's page.",
          )}
          {field(
            applyBrand,
            setApplyBrand,
            "Brand",
            <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Arduino" disabled={!applyBrand} />,
          )}
          {field(
            applyModel,
            setApplyModel,
            "Model",
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. Uno R3" disabled={!applyModel} />,
          )}
          {field(
            applyImage,
            setApplyImage,
            "Image URL",
            <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" disabled={!applyImage} />,
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || groupIds.length === 0}>
            {busy ? <LoadingGifInline size={18} className="size-4" /> : null}
            {busy ? "Applying…" : `Apply to ${groupIds.length} group(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
