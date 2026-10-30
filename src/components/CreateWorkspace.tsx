"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function CreateWorkspace() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    const { data, error } = await createClient().rpc("create_workspace", { p_name: name.trim() });
    setLoading(false);
    if (error) return setError(error.message);
    router.push(`/w/${data}`);
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl bg-white p-8 shadow">
      <h1 className="text-xl font-semibold">Crie seu workspace</h1>
      <p className="text-sm text-slate-500">
        Um workspace reúne seus Spaces, listas e tarefas. Você pode convidar a equipe depois.
      </p>
      <input
        autoFocus
        placeholder="Ex.: Nitron"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-md border px-3 py-2 text-sm outline-none focus:border-violet-500"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        disabled={loading}
        className="w-full rounded-md bg-violet-600 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
      >
        {loading ? "Criando..." : "Criar workspace"}
      </button>
    </form>
  );
}
