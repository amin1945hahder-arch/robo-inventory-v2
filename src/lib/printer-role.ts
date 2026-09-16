/**
 * Shared client-side rule for the "printer" privilege. Mirrors
 * src/convex/lib.ts hasPrinterPrivilege so UI gating and backend gating can
 * never drift: the privilege stacks on any role and admins hold it implicitly.
 */
export function hasPrinterPrivilege(user: {
  role?: string;
  printerRole?: boolean;
} | null | undefined): boolean {
  if (!user) return false;
  return user.role === "admin" || user.printerRole === true;
}

/** People-page style label for the privilege chip. */
export function printerPrivilegeLabel(user: {
  role?: string;
  printerRole?: boolean;
} | null | undefined): string {
  if (!user) return "—";
  if (user.role === "admin") return "admin (implicit)";
  return user.printerRole ? "granted" : "not granted";
}
