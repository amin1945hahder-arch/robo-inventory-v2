// Comma-separated list of admin emails (env var ADMIN_EMAILS), e.g.
// ADMIN_EMAILS=essa@university.edu,lab@university.edu
// The first matching person to sign in is promoted to admin automatically.
export function adminAllowList(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function emailInAdminList(email: string): boolean {
  const list = adminAllowList();
  if (list.length === 0) return false;
  return list.includes(email.trim().toLowerCase());
}
