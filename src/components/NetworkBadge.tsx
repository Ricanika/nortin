"use client";

import { networkOf } from "@/lib/social";

/** Selo colorido da rede (IG, FB, TT, IN, YT…). */
export default function NetworkBadge({ platform, dim = false }: { platform: string; dim?: boolean }) {
  const n = networkOf(platform);
  return (
    <span
      title={n.label}
      className={`inline-flex h-5 min-w-[22px] items-center justify-center rounded px-1 text-[9px] font-bold text-white ${dim ? "opacity-25" : ""}`}
      style={{ background: n.color }}
    >
      {n.short}
    </span>
  );
}
