import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CreateWorkspace from "@/components/CreateWorkspace";

export default async function Home() {
  const supabase = await createClient();
  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id")
    .order("created_at")
    .limit(1);

  if (workspaces && workspaces.length > 0) redirect(`/w/${workspaces[0].id}`);

  const { data: auth } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <CreateWorkspace email={auth.user?.email ?? ""} />
    </main>
  );
}
