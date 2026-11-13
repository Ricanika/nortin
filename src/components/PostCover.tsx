"use client";

import { createContext, useContext } from "react";
import type { Task } from "@/lib/types";

/** Tipo da lista aberta, para os cartões e linhas se adaptarem (ex.: conteúdo não risca o publicado). */
export const ListKindContext = createContext<"tasks" | "campaign" | "content">("tasks");
export const useListKind = () => useContext(ListKindContext);

/** Capinha do post: 1ª imagem ou o 1º quadro do vídeo; mostra quantas mídias tem. */
export default function PostCover({ media, size = 36, wide = false }: { media: Task["media"]; size?: number; wide?: boolean }) {
  const box = wide ? { width: "100%", height: 140 } : { width: size, height: size };
  const first = media?.[0];
  if (!first) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-md border border-dashed border-slate-300 text-[10px] text-slate-300"
        style={box}
        title="Sem imagem"
      >
        🖼
      </span>
    );
  }
  const isVideo = first.type.startsWith("video/");
  return (
    <span className="relative block shrink-0 overflow-hidden rounded-md bg-slate-100 ring-1 ring-black/5" style={box}>
      {isVideo ? (
        // #t=0.5: o navegador mostra um quadro do começo do vídeo como capa
        <video src={`${first.url}#t=0.5`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={first.url} alt="" loading="lazy" className="h-full w-full object-cover" />
      )}
      {isVideo && <span className="absolute bottom-0 left-0 rounded-tr bg-black/60 px-0.5 text-[8px] leading-tight text-white">▶</span>}
      {media.length > 1 && (
        <span className="absolute right-0 top-0 rounded-bl bg-black/60 px-1 text-[9px] font-semibold leading-tight text-white">{media.length}</span>
      )}
    </span>
  );
}
