import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";
import { WorkspaceProvider } from "@/components/WorkspaceContext";
import { ToastProvider } from "@/components/Toast";
import { QuickAddProvider } from "@/components/QuickAdd";
import type { Member, Role } from "@/lib/types";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const supabase = await createClient();
  const [{ data: workspace }, { data: workspaces }, { data: auth }, { data: memberRows }] =
    await Promise.all([
      supabase.from("workspaces").select("id, name, owner_id").eq("id", workspaceId).maybeSingle(),
      supabase.from("workspaces").select("id, name, owner_id").order("created_at"),
      supabase.auth.getUser(),
      supabase
        .from("workspace_members")
        .select("user_id, role, profiles(email, full_name)")
        .eq("workspace_id", workspaceId)
        .order("created_at"),
    ]);
  if (!workspace || !auth.user) notFound();

  const members: Member[] = (memberRows ?? []).map((m) => {
    const p = m.profiles as unknown as { email: string | null; full_name: string | null } | null;
    return { user_id: m.user_id, role: m.role as Role, email: p?.email ?? null, full_name: p?.full_name ?? null };
  });
  const role = members.find((m) => m.user_id === auth.user.id)?.role ?? "guest";

  return (
    <WorkspaceProvider value={{ workspace, members, me: auth.user.id, role }}>
      <ToastProvider>
        <QuickAddProvider>
          <div className="flex h-screen overflow-hidden">
            <Sidebar workspaces={workspaces ?? []} userEmail={auth.user.email ?? ""} />
            <main className="flex min-w-0 flex-1 flex-col">{children}</main>
          </div>
        </QuickAddProvider>
      </ToastProvider>
    </WorkspaceProvider>
  );
}
