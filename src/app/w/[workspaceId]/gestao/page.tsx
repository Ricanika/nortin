import { Suspense } from "react";
import Gestao from "@/components/Gestao";

export default function GestaoPage() {
  return (
    <Suspense>
      <Gestao />
    </Suspense>
  );
}
