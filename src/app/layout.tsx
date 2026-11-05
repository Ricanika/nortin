import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hyak Group",
  description: "Gestão de tarefas: workspaces, listas e quadros.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
