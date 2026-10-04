import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * Avatar + name chip used wherever an editor/author must be credited with a
 * file change: README history entries, the split-view review header and the
 * request lists in the console.
 */
export function EditorChip({
  name,
  image,
  size = "sm",
  className,
}: {
  name: string;
  image?: string | null;
  /** sm = 20px avatar (default), xs = 16px, inline with smaller text. */
  size?: "sm" | "xs";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 text-sm",
        size === "xs" && "text-xs",
        className,
      )}
    >
      <Avatar className={size === "xs" ? "size-4 shrink-0" : "size-5 shrink-0"}>
        <AvatarImage src={image ?? undefined} alt={name} />
        <AvatarFallback className="bg-primary/15 text-primary text-[9px] font-semibold">
          {(name || "?").slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="truncate font-medium">{name}</span>
    </span>
  );
}
