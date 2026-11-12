"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Painel flutuante preso ao botão que o abriu. Vai para o <body> com position: fixed
 * para não ser cortado por tabelas e colunas com rolagem.
 */
export default function Popover({
  trigger,
  children,
  width = 224,
  label,
  triggerClassName = "",
}: {
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  width?: number;
  label: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const height = panel.current?.offsetHeight ?? 200;
    const below = r.bottom + 4 + height < window.innerHeight;
    setPos({
      top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - height),
      left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
    });
  }, [open, width]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key !== "Escape") return;
      // Clique ou rolagem dentro do painel (ex.: campo com link longo rolando o texto) não fecha
      const inside = panel.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node);
      if ((e.type === "mousedown" || e.type === "scroll") && inside) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
        <div
          ref={panel}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ top: pos.top, left: pos.left, width }}
          className="fixed z-50 max-h-80 overflow-y-auto rounded-lg border bg-white py-1 text-sm shadow-xl"
        >
          {children(() => setOpen(false))}
        </div>,
        document.body,
      )}
    </>
  );
}
