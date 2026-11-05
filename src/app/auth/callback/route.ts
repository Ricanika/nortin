import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Link do e-mail de confirmação: troca o código por uma sessão e entra direto no app.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/", request.url));
  }
  // Sem código válido (link aberto em outro navegador, por exemplo): o e-mail já foi confirmado, basta entrar.
  return NextResponse.redirect(new URL("/login?confirmed=1", request.url));
}
