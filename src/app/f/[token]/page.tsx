import type { Metadata } from "next";
import { loadPublicForm } from "@/lib/briefingForm";
import BriefingForm from "@/components/BriefingForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Briefing · Hyak Group", robots: { index: false } };

export default async function PublicFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = await loadPublicForm(token);
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 text-center">
          <div className="text-sm font-semibold text-violet-600">Hyak Group</div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">📝 Briefing de demanda</h1>
          {form && (
            <p className="mt-1 text-sm text-slate-500">
              Vai para: <b>{form.spaceName} / {form.listName}</b>
            </p>
          )}
        </div>
        {form ? (
          <BriefingForm token={token} members={form.members} />
        ) : (
          <div className="rounded-xl bg-white p-8 text-center shadow-sm">
            <p className="font-semibold text-slate-700">Este formulário não está disponível.</p>
            <p className="mt-1 text-sm text-slate-500">O link pode ter sido trocado ou desativado. Peça o link novo para a equipe.</p>
          </div>
        )}
      </div>
    </main>
  );
}
