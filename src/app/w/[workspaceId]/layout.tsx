import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const supabase = await createClient();
  const [{ data: workspace }, { data: workspaces }, { data: auth }] = await Promise.all([
    supabase.from("workspaces").select("id, name, owner_id").eq("id", workspaceId).maybeSingle(),
    supabase.from("workspaces").select("id, name, owner_id").order("created_at"),
    supabase.auth.getUser(),
  ]);
  if (!workspace) notFound();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        workspace={workspace}
        workspaces={workspaces ?? []}
        userEmail={auth.user?.email ?? ""}
      />
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
