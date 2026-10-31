"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

interface ToastItem {
  id: number;
  text: string;
  undo?: () => void;
}

const Ctx = createContext<(text: string, opts?: { undo?: () => void }) => void>(() => {});

/** Avisos curtos no rodapé, com "Desfazer" no lugar de perguntas de confirmação. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (text: string, opts?: { undo?: () => void }) => {
      const id = ++seq.current;
      setItems((prev) => [...prev.slice(-2), { id, text, undo: opts?.undo }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-center gap-4 rounded-lg bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg"
          >
            <span>{t.text}</span>
            {t.undo && (
              <button
                onClick={() => {
                  t.undo!();
                  dismiss(t.id);
                }}
                className="font-semibold text-violet-300 hover:text-white"
              >
                Desfazer
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
