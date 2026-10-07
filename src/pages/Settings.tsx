import { useAuth } from "@/hooks/use-auth";
import AdminSettings from "@/pages/AdminSettings";
import MemberSettings from "@/pages/MemberSettings";

/**
 * `/settings` for every signed-in role.
 *
 *  - admins keep the full lab console (AdminSettings);
 *  - members and students get the personal MemberSettings page.
 *
 * Keeping one route means the nav link works for everyone, and a member never
 * lands on an admin page that would reject their queries.
 */
export default function Settings() {
  const { user } = useAuth();
  return user?.role === "admin" ? <AdminSettings /> : <MemberSettings />;
}
