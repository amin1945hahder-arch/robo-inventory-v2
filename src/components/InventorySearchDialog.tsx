import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Search } from "lucide-react";

/**
 * Global "search anything" dialog: type freely, optionally narrow by
 * category / storage / availability, then land on /inventory with the
 * filters applied as URL params (?q=&category=&closet=&avail=).
 */
export function InventorySearchDialog({
  open,
  onOpenChange,
  categories,
  closets,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories?: Doc<"categories">[];
  closets?: Doc<"closets">[];
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [closetId, setClosetId] = useState("all");
  const [avail, setAvail] = useState("all");

  // Seed from the URL each time the dialog opens so it edits the live filters.
  useEffect(() => {
    if (!open) return;
    const params = new URLSearchParams(window.location.search);
    setQ(params.get("q") ?? "");
    setCategoryId(params.get("category") ?? "all");
    setClosetId(params.get("closet") ?? "all");
    setAvail(params.get("avail") ?? "all");
  }, [open]);

  const apply = () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (categoryId !== "all") params.set("category", categoryId);
    if (closetId !== "all") params.set("closet", closetId);
    if (avail !== "all") params.set("avail", avail);
    onOpenChange(false);
    navigate(`/inventory?${params.toString()}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Search inventory</DialogTitle>
          <DialogDescription>
            Search anything by name, brand, model or description — groups inside
            containers are found too.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <div className="relative">
            <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search parts, brands, models…"
              className="pl-9"
            />
          </div>
          <div className="grid gap-2">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {(categories ?? []).map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Storage</Label>
            <Select value={closetId} onValueChange={setClosetId}>
              <SelectTrigger>
                <SelectValue placeholder="Storage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All storages</SelectItem>
                {(closets ?? []).map((c) => (
                  <SelectItem key={c._id} value={c._id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Availability</Label>
            <Select value={avail} onValueChange={setAvail}>
              <SelectTrigger>
                <SelectValue placeholder="Availability" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any availability</SelectItem>
                <SelectItem value="available">Has available units</SelectItem>
                <SelectItem value="none">Nothing available</SelectItem>
                <SelectItem value="out">Any unit out (rented/project)</SelectItem>
                <SelectItem value="broken">Has broken units</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">
              <Search className="size-4" /> Search
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
