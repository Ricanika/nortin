import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { GhlError, ghlConfig, listAccounts, type GhlSpace } from "@/lib/ghl";

// Contas conectadas no GHL da marca (Space) da lista
export async function GET(request: NextRequest) {
  const listId = request.nextUrl.searchParams.get("listId");
  if (!listId) return NextResponse.json({ error: "Informe a lista" }, { status: 400 });
  const supabase = await createClient();
  const { data: list } = await supabase
    .from("lists")
    .select("id, spaces(ghl_location_id, ghl_token_env, ghl_user_id)")
    .eq("id", listId)
    .maybeSingle();
  if (!list) return NextResponse.json({ error: "Lista não encontrada" }, { status: 404 });
  try {
    const { locationId, token } = ghlConfig(list.spaces as unknown as GhlSpace);
    const accounts = await listAccounts(token, locationId);
    return NextResponse.json({
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        platform: a.platform,
        avatar: a.avatar ?? null,
        connected: a.active && !a.isExpired,
      })),
    });
  } catch (e) {
    const err = e instanceof GhlError ? e : new GhlError("Falha ao falar com o GHL");
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
