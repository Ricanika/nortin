import { redirect } from "next/navigation";

// "Minhas tarefas" foi juntado ao "Meu dia": quem tinha o link salvo cai lá.
export default async function MyTasksPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  redirect(`/w/${workspaceId}`);
}
