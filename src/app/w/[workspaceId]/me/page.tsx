import { Suspense } from "react";
import MyTasks from "@/components/MyTasks";

export default function MyTasksPage() {
  return (
    <Suspense>
      <MyTasks />
    </Suspense>
  );
}
