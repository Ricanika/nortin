"use client";

import { useState } from "react";
import Popover from "./Popover";

/** Nome amigável do serviço pelo endereço do link. */
export function folderService(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith("sharepoint.com")) return "SharePoint";
    if (host.endsWith("onedrive.live.com") || host === "1drv.ms") return "OneDrive";
    if (host === "drive.google.com" || host === "docs.google.com") return "Google Drive";
    if (host.endsWith("dropbox.com")) return "Dropbox";
    return host.replace(/^www\./, "");
  } catch {
    return "link";
  }
}

const isValid = (url: string) => /^https:\/\/\S+$/i.test(url.trim());

/**
 * Link da pasta (OneDrive/SharePoint/Drive): abre numa aba nova; os arquivos ficam no serviço.
 * `inherited` é a pasta da lista, mostrada na tarefa que não tem pasta própria.
 */
export default function FolderLink({
  value,
  onSave,
  inherited,
  subject,
}: {
  value: string | null;
  onSave: (url: string | null) => void;
  inherited?: string | null;
  subject: "lista" | "tarefa";
}) {
  const shown = value ?? inherited ?? null;
  const fromList = !value && !!inherited;

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {shown && (
        <a
          href={shown}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium ${
            fromList ? "bg-slate-100 text-slate-600 hover:bg-slate-200" : "bg-sky-50 text-sky-700 hover:bg-sky-100"
          }`}
          title={shown}
        >
          📁 {fromList ? "Pasta da lista" : "Abrir pasta"}
          <span className="text-xs font-normal opacity-70">· {folderService(shown)} ↗</span>
        </a>
      )}
      <Popover
        label={value ? `Trocar pasta da ${subject}` : `Vincular pasta à ${subject}`}
        width={320}
        triggerClassName={
          shown
            ? "rounded px-1.5 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            : "rounded-md border border-dashed px-2 py-1 text-xs text-slate-500 hover:border-sky-400 hover:text-sky-700"
        }
        trigger={shown ? (fromList ? "+ pasta própria" : "✏️") : "📁 Vincular pasta"}
      >
        {(close) => <FolderForm initial={value ?? ""} subject={subject} onSave={(url) => { onSave(url); close(); }} />}
      </Popover>
    </span>
  );
}

function FolderForm({
  initial,
  subject,
  onSave,
}: {
  initial: string;
  subject: "lista" | "tarefa";
  onSave: (url: string | null) => void;
}) {
  const [url, setUrl] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-2 px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isValid(url)) return setError("Cole um link que comece com https://");
        onSave(url.trim());
      }}
    >
      <label htmlFor={`folder-${subject}`} className="block text-xs font-medium text-slate-600">
        Link da pasta da {subject}
      </label>
      <input
        id={`folder-${subject}`}
        autoFocus
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setError(null);
        }}
        placeholder="https://…sharepoint.com/…"
        className="w-full rounded border px-2 py-1.5 text-sm outline-none focus:border-sky-500"
      />
      <p className="text-[11px] leading-snug text-slate-400">
        No OneDrive: clique com o botão direito na pasta → <b>Compartilhar</b> → <b>Copiar link</b>. Quem abrir precisa ter
        acesso à pasta no OneDrive.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button className="flex-1 rounded bg-sky-600 py-1.5 text-sm font-medium text-white hover:bg-sky-700">Salvar</button>
        {initial && (
          <button type="button" onClick={() => onSave(null)} className="rounded border px-3 text-sm text-slate-500 hover:bg-slate-50">
            Remover
          </button>
        )}
      </div>
    </form>
  );
}
