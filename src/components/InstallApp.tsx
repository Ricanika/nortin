"use client";

import { useEffect, useState } from "react";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const INSTALLED = "hyak:installed";
const LATER = "hyak:install-later"; // "Agora não": some só até fechar o navegador

const read = (s: Storage, k: string) => {
  try {
    return s.getItem(k);
  } catch {
    return null;
  }
};
const write = (s: Storage, k: string, v: string) => {
  try {
    s.setItem(k, v);
  } catch {
    // navegador sem armazenamento: o aviso só volta a aparecer
  }
};

/**
 * Convite para instalar o app no computador (como programa, com ícone na barra de tarefas).
 * Aparece toda vez que abrir no navegador; some quando já está instalado ou aberto como app.
 */
export default function InstallApp() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [safari, setSafari] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) {
      write(localStorage, INSTALLED, "1");
      return;
    }
    if (read(sessionStorage, LATER)) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      // O navegador só oferece instalar quando ainda não está instalado
      try {
        localStorage.removeItem(INSTALLED);
      } catch {}
      setEvent(e as InstallEvent);
      setOpen(true);
    };
    const onInstalled = () => {
      write(localStorage, INSTALLED, "1");
      setOpen(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // Safari (Mac/iPhone) não tem o botão automático: mostramos como instalar pelo menu
    const ua = navigator.userAgent;
    const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox|FxiOS|CriOS/.test(ua);
    let t: ReturnType<typeof setTimeout> | undefined;
    if (isSafari && !read(localStorage, INSTALLED)) {
      t = setTimeout(() => {
        setSafari(true);
        setOpen(true);
      }, 1500);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (t) clearTimeout(t);
    };
  }, []);

  if (!open) return null;

  const later = () => {
    write(sessionStorage, LATER, "1");
    setOpen(false);
  };
  const install = async () => {
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") write(localStorage, INSTALLED, "1");
    setEvent(null);
    setOpen(false);
  };
  const iphone = /iPhone|iPad/.test(typeof navigator !== "undefined" ? navigator.userAgent : "");

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="install-title">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" className="h-12 w-12 rounded-xl" />
          <div>
            <h2 id="install-title" className="font-semibold text-slate-900">
              Instalar o Hyak {iphone ? "no celular" : "no computador"}
            </h2>
            <p className="text-xs text-slate-500">Abre direto, com ícone próprio, sem procurar a aba no navegador.</p>
          </div>
        </div>

        <ul className="mt-4 space-y-1 text-sm text-slate-600">
          <li>⚡ Abre em janela própria, mais rápido</li>
          <li>📌 Ícone na barra de tarefas e no menu Iniciar</li>
          <li>🔔 Avisos de tarefas como os do Teams</li>
        </ul>

        {safari && (
          <p className="mt-4 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900">
            {iphone ? (
              <>
                Toque em <b>Compartilhar</b> (o quadrado com a seta) e depois em <b>Adicionar à Tela de Início</b>.
              </>
            ) : (
              <>
                No menu <b>Arquivo</b> do Safari, clique em <b>Adicionar ao Dock</b>.
              </>
            )}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={later} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">
            Agora não
          </button>
          {event ? (
            <button onClick={() => void install()} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">
              Instalar
            </button>
          ) : (
            <button
              onClick={() => {
                write(localStorage, INSTALLED, "1");
                setOpen(false);
              }}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
            >
              Já instalei
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
