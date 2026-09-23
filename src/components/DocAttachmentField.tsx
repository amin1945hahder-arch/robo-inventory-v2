import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Paperclip, X } from "lucide-react";

export interface AttachedDoc {
  name: string;
  mime: string;
  size: number;
  dataUrl: string;
}

export const MAX_DOC_BYTES = 400_000; // ~400 KB raw — data URLs must fit the DB row

/** Read a file into a small data URL (kept as-is for docs, compressed for images). */
export async function readFileAsDoc(file: File): Promise<AttachedDoc> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
  return { name: file.name, mime: file.type || "application/octet-stream", size: file.size, dataUrl };
}

/**
 * File/image picker used by return forms: attach a delivery note, a photo of
 * the handover, a donation form… stored as a small data URL on the record.
 */
export function DocAttachmentField({
  label = "Documentation (file or image)",
  doc,
  onChange,
}: {
  label?: string;
  doc: AttachedDoc | null;
  onChange: (doc: AttachedDoc | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_DOC_BYTES && !file.type.startsWith("image/")) {
      window.alert("File is too large — 400 KB max (photos are compressed automatically)");
      return;
    }
    if (file.type.startsWith("image/")) {
      // Photos are compressed client-side so they always fit the record.
      setBusy(true);
      try {
        const { compressImageFile } = await import("@/lib/utils");
        const compressed = await compressImageFile(file, 800);
        onChange({
          name: file.name.replace(/\.[^.]+$/, "") + ".jpg",
          mime: "image/jpeg",
          size: Math.round((compressed.length * 3) / 4),
          dataUrl: compressed,
        });
      } catch {
        window.alert("Could not process that image — try another file");
      } finally {
        setBusy(false);
      }
      return;
    }
    onChange(await readFileAsDoc(file));
  };

  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {doc ? (
        <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
          {doc.mime.startsWith("image/") ? (
            <img src={doc.dataUrl} alt={doc.name} className="size-8 rounded object-cover" />
          ) : (
            <Paperclip className="size-4 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm">{doc.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => onChange(null)}
            aria-label="Remove attachment"
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <>
          <Input
            ref={inputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx,.txt,.csv"
            className="cursor-pointer"
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {busy && <p className="text-xs text-muted-foreground">Compressing image…</p>}
        </>
      )}
      <p className="text-xs text-muted-foreground">Stored with the return record as proof of handover.</p>
    </div>
  );
}
