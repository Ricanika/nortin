import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /api/social/sync é chamado pelo robô da Vercel (sem login); a rota confere o CRON_SECRET
// /f/ e /api/forms/ são o formulário público de briefing (quem pede a demanda não tem conta)
const PUBLIC_PATHS = ["/login", "/auth/callback", "/api/social/sync", "/f/", "/api/forms/"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // arquivos públicos (ícones, manifesto) abrem sem login: o aviso do Windows e a instalação usam eles
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webmanifest)$).*)"],
};
