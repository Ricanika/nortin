import { Suspense } from "react";
import ListScreen from "@/components/ListScreen";

export default async function ListPage({
  params,
}: {
  params: Promise<{ workspaceId: string; listId: string }>;
}) {
  const { listId } = await params;
  return (
    <Suspense>
      <ListScreen key={listId} listId={listId} />
    </Suspense>
  );
}
