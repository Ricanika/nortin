import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function WorkspaceHome({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const supabase = await createClient();
  const { data: lists } = await supabase
    .from("lists")
    .select("id")
    .eq("workspace_id", workspaceId)
    .order("position")
    .limit(1);

  if (lists && lists.length > 0) redirect(`/w/${workspaceId}/l/${lists[0].id}`);

  return (
    <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
      Crie um Space e uma lista na barra lateral para começar.
    </div>
  );
}
