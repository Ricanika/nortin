# Hyak Group: gerenciador de demandas (contexto para o Claude)

App interno de gestão de tarefas do **Hyak Group** (marcas Nitron, Teak Brazil, Roga Village, Mood Fruits, Mundo UD), no estilo ClickUp. Feito para pessoas leigas em tecnologia: **responda sempre em português do Brasil**, em linguagem simples, e explique passo a passo o que a pessoa precisa clicar.

## Onde está cada coisa

| O quê | Onde |
|---|---|
| Código | GitHub `ricanika/nortin` |
| Branch de trabalho (é a que a Vercel publica) | `claude/festive-wright-15n19w` |
| App no ar | https://hyakgroup.vercel.app (projeto **hyakgroup** na Vercel) |
| Banco, login, arquivos e robôs | Supabase, projeto `kzakyzfjiunvkwiypahi` (região sa-east-1) |
| Conferir a versão no ar e as chaves | `/api/health` (só dono/admin; mostra o commit e ✅/❌ de cada variável) |

Não crie pull request sem pedido. Faça commit e push na branch acima: a Vercel publica sozinha em 1 a 2 minutos.

## Tecnologia

- Next.js 15 (App Router), React 19, TypeScript, Tailwind 3.4, `@supabase/ssr` + `supabase-js`, dnd-kit.
- Supabase Postgres com RLS (`is_member`, `is_admin`, `is_owner`), funções `security definer`, triggers, Realtime, Storage (`social-media`, `pdv`), `pg_cron` + `pg_net`.
- Testes de tela: Playwright com Chromium já instalado. Padrão usado: página temporária `src/app/login-*-preview/page.tsx` (rota pública por começar com `/login`) com dados de exemplo e `.env.local` falso (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9`). **Apague a página, o `.env.local` e `.next/types` antes do commit.**
- Antes de commitar: `npx tsc --noEmit -p .` e `npm run build`. Não rode o formatador (Prettier) nos arquivos: o projeto não usa, e ele reescreve tudo.

## Estrutura

- `supabase/migrations/0001…0020`: todas **já aplicadas** em produção. Mudança nova = arquivo novo numerado + aplicar no Supabase.
- `src/app/w/[workspaceId]/…`: telas logadas (Meu dia, Gestão, Membros, listas `l/[listId]`).
- `src/components/`: `Sidebar` (pastas → Spaces → listas), `ListScreen` (carrega a lista e as ações), `ListView` (lista + cartões no celular + seleção em massa), `BoardView`, `CalendarView`, `TaskDrawer` (detalhes + chat), `MyDay`, `Gestao`, `InstallApp` (convite PWA), `MoveTask`.
- `src/lib/`: regras e integrações (`ghl.ts`, `meta.ts`, `sankhya.ts`, `pdv.ts`, `pdvSync.ts`, `launch.ts`, `social.ts`, `socialSync.ts`, `types.ts`).

## Conceitos do app

- **Workspace → Pastas (`space_groups`) → Spaces → Listas → Tarefas.** Só o dono cria e organiza Spaces e pastas. Arquivar nunca apaga.
- Pastas atuais: **Marketing** (Nitron, Teak Brazil, Roga Village, Mood Fruits, Mundo UD) e **Comercial** (Nitron PDV).
- Tarefa: status da lista, 2 prioridades (Urgente/Importante), prazo com horário opcional (`due_time`), recorrência, responsáveis, link de pasta, chat (mensagens não se editam). Mover tarefas: função `move_task` (status pelo mesmo nome, senão pelo mesmo tipo).
- **Tipos de lista** (`lists.kind`), escolhidos no ⋯ da lista:
  - `tasks`: comum.
  - `campaign`: resultados Google/Meta Ads (impressões, cliques, CPC, gasto) digitados.
  - `content`: posts publicados pelo **GoHighLevel** (GHL); métricas por rede; alcance automático pela **Meta**.
  - `pdv`: **Gestão de PDV** (visitas de merchandising), dados do **Sankhya** pelo MCP.
  - `launch`: **Lançamento de produtos** (processo Nitron v1.0: trilhas A–F, fases F0–F7, portões G0–G5).
- Formulário público de briefing por lista (`/f/[token]`).

## Integrações (os segredos ficam **só** na Vercel)

Nunca escreva chaves no código, no GitHub ou no chat. Peça para a pessoa cadastrar na Vercel (**Settings → Environment Variables**, marcar **Production**, depois **Redeploy**) e confira em `/api/health`.

| Variável | Para quê |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase |
| `CRON_SECRET` | robô diário da Vercel |
| `GHL_TOKEN_NITRON`, `GHL_TOKEN_TEAK`, `GHL_TOKEN_ROGA` | GoHighLevel (uma chave por subconta; o Space aponta para a variável) |
| `META_TOKEN` | Meta (usuário do sistema "robo-hyak", app "App Hyak"): alcance e views |
| `SANKHYA_MCP_URL`, `SANKHYA_MCP_TOKEN` (opcional `SANKHYA_MCP_HEADER`) | MCP do Sankhya, só leitura |
| `GEMINI_API_KEY` | criar tarefa por áudio (opcional, ainda não configurada) |

### GoHighLevel (posts)
- API v2 (`services.leadconnectorhq.com`, header `Version: 2021-07-28`). Publicar = agendar (`status: scheduled`); "publicar agora" = +5 min (repete com +15 se recusar). `mediaOptimization: false` (senão o vídeo perde qualidade). Stories: um por mídia. Link de CTA: no Instagram vai no 1º comentário. Capa de Reels: `media[].thumbnail`.
- Depois de publicado, cada rede vira um post filho com `parentPostId` = `_id` do agendamento. Guardamos os dois em `tasks.ghl_parent_ids`. O GHL dá curtidas, comentários e compartilhamentos, mas não dá alcance.

### Meta (alcance)
- `src/lib/meta.ts`. Instagram: `reach`; nos **stories o alcance = views** (só existem nas primeiras 24h). Facebook: alcance do post pela chave da página (stories do Facebook não têm números por API).
- Se o código do GHL não existir na Meta, procura o post pelo link na conta do Instagram.
- O robô roda **de hora em hora** pelo Supabase (`pg_cron` job `hyak-hourly-sync` → `/api/social/sync`, chave em `app_secrets`). No 1º dia de cada post atualiza a cada hora, depois diário, semanal e mensal.
- Páginas compartilhadas com o robô hoje: **Roga Village** e **Teak Brazil**. A **Nitron** ainda não foi compartilhada (falta no Business Manager).
- Diagnóstico: `/api/social/meta-check` (`?media=ID`, `?ig=ID&link=URL`, `?ig=ID&stories=1`).

### Sankhya (ERP), pela MCP do TI
- O TI **não libera a API direta**; libera views pelo MCP. A chave do app só lê:
  `AD_VW_GPDV_PARCEIRO`, `AD_VW_GPDV_VENDAS_MES`, `AD_VW_GPDV_PRODUTOS_12M`, `AD_VW_GPDV_BASE_MES`.
- Precisa de outro dado? Escreva o SQL da view e peça ao TI. **Não use o prefixo `AD_VW_PDV_`**: ele já existe para o sistema de caixa.
- Venda = views do comercial (`AD_VW_COM_NOTAS`). A base de comparação exclui site e marketplace (TOPs 3225 e 3226).
- Cliente MCP em `src/lib/sankhya.ts` (JSON-RPC: `initialize` → `tools/call` `sankhya_query`). O robô diário `hyak-pdv-sync` (06h17) chama `/api/pdv/sync`.

## Gestão de PDV (`kind = pdv`)
Etapas: A visitar → Agendada → Visitada → Em acompanhamento → Concluída / Cancelada. Digitar o código do parceiro (ou criar a tarefa só com o número) busca nome, endereço (vai como 1ª mensagem do chat, com link do Maps), vendas e curva ABC. Antes × depois: média dos **6 meses fechados antes** do mês da visita contra os **meses fechados depois** (até 3), frequência, ticket e "acima da base". A visita é medida pela **loja visitada**. Há checklist de merchandising, fotos de antes e depois, curva A com foto do produto (tirada no app) e contagem de estoque. Tabelas `pdv_*`.

## Lançamento de produtos (`kind = launch`)
Etapas: F0 Ideia e triagem → F1 Conceito → F2 Projeto e protótipo → F3 Ferramentaria → F4 Cadastro → F5 Lote piloto → F6 Lançamento → F7 Acompanhamento → **Mantido** / **Encerrado** (com motivo: barrado no portão ou descontinuado no G5). Regras em `src/lib/launch.ts`: o Portão 0 (6 perguntas) define a trilha, D e E pulam a F3, cada portão tem critérios e quem decide, dossiê G0/G1, checklist de cadastro por trilha e revisões de 90/180/365 dias. Os portões **avisam, não travam**, e qualquer membro aprova. Dados em `tasks.launch` (jsonb).

## Decisões e preferências da pessoa
- Não criar tarefas a partir de planilhas sem pedido.
- Celular importa: cada tela nova precisa funcionar no celular (cartões em vez de colunas, menu em gaveta).
- Antes de construir algo grande, propor e conversar; quando a pessoa disser "faça", executar.
- Dizer com clareza o que foi testado e o que não foi.

## Pendências conhecidas
- Compartilhar a página e o Instagram da **Nitron** com o robo-hyak (Meta).
- Lançamento: views do Sankhya para "já existe no catálogo?" e números do F7 (faturamento, clientes, devolução por CODPROD).
- PDV: fotos de produto automáticas (precisaria de uma view com o link da imagem).
- Prazos (SLA) por fase do lançamento, quando definidos.
- Rota de visitas do PDV (passo 2).
- Trocar as chaves do GHL, que já foram coladas no chat no passado.
