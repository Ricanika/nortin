# Hyak Group

Gestor de tarefas inspirado no modelo de produtividade de ferramentas como o ClickUp
(funcionalidade recriada do zero — sem marca, código ou assets de terceiros).

**Fase 1 do MVP:** auth, workspaces, Spaces, listas, tarefas, status customizáveis,
view **Lista**, view **Quadro** (Kanban com arrastar e soltar), painel da tarefa
com subtarefas e comentários, e atualização em tempo real.

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind
- Supabase: Postgres, Auth, Realtime e RLS
- dnd-kit para o Kanban

## Modelo de dados

```
workspaces ─┬─ workspace_members ── profiles
            └─ spaces ── (folders) ── lists ─┬─ statuses
                                              └─ tasks ─┬─ tasks (subtarefas)
                                                        ├─ comments
                                                        └─ task_assignees
```

- Toda tabela tem `workspace_id`, preenchido por trigger a partir do pai. O cliente
  não consegue forjar esse valor, e as policies de RLS são só `is_member(workspace_id)`.
- Lista nova já nasce com 3 status (A fazer / Em andamento / Concluído).
- O workspace é criado pela RPC `create_workspace(nome)`, que já cria um Space e uma lista.
- A ordem é fracionária (`position`): mover um card grava a média dos vizinhos (uma só linha atualizada).

## Permissões

| Ação | Dono | Administrador | Membro |
|---|---|---|---|
| Criar, renomear e excluir Spaces | ✅ | — | — |
| Adicionar e remover membros | ✅ | ✅ | — |
| Promover membro a administrador | ✅ | — | — |
| Criar listas, tarefas e status | ✅ | ✅ | ✅ |
| Marcar responsáveis | ✅ | ✅ | ✅ |
| Arquivar e desarquivar listas e Spaces | ✅ | ✅ | ✅ |
| Renomear listas | ✅ | ✅ | ✅ |

O dono é quem criou o workspace e não pode ser removido nem trocado. Essas regras valem no
banco (RLS e triggers), não só na tela.

## Como rodar

1. Crie um projeto no [Supabase](https://supabase.com).
2. Rode a migration `supabase/migrations/0001_init.sql`, colando no **SQL Editor** ou com
   `supabase db push` se usar a CLI.
3. Configure as variáveis:
   ```bash
   cp .env.example .env.local
   ```
   Preencha com a URL e a anon key (Project Settings → API).
4. Opcional, para criar tarefas por áudio com IA (várias tarefas num áudio só): crie uma chave grátis em
   https://aistudio.google.com/apikey e configure `GEMINI_API_KEY` (no `.env.local` e na Vercel).
   Sem ela, o microfone usa o ditado do navegador, uma tarefa por vez.
5. Opcional, para publicar nas redes pelo GoHighLevel (listas de conteúdo):
   - uma Private Integration por subconta do GHL, em variáveis `GHL_TOKEN_<MARCA>` (o nome vai em `spaces.ghl_token_env`,
     junto com `ghl_location_id` e `ghl_user_id`);
   - `SUPABASE_SERVICE_ROLE_KEY` e `CRON_SECRET`, usados pelo robô diário de métricas (`vercel.json`).
   Chaves só nas variáveis de ambiente, nunca no código.
6. Opcional para desenvolvimento: em Authentication → Providers → Email, desligue
   "Confirm email" para entrar logo após o cadastro.
7. Suba o app:
   ```bash
   npm install
   npm run dev
   ```
   Abra http://localhost:3000.

## Roadmap

- [x] Fase 1: hierarquia, tarefas, status, Lista, Quadro, subtarefas, comentários, realtime
- [x] Fase 2: responsáveis, membros por e-mail, "Minhas tarefas", só o dono cria Spaces
- [x] UX: "Meu dia", criação rápida (botão, tecla N, frase com @nome/amanhã/!urgente), criar por áudio,
      concluir com 1 clique, edição direto na linha, "Desfazer" no lugar de confirmações
- [x] Gestão (dono e administradores): todas as tarefas com filtros, carga por membro, tarefas sem prazo
      e ações em massa (prazo, prioridade, responsável, concluir)
- [x] Arquivar e desarquivar listas e Spaces (qualquer membro), renomear pelo menu ⋯
- [x] Etapa "Cancelado" em todas as listas; tarefas recorrentes (todo dia, dias úteis, semanal, mensal, anual):
      ao concluir, o banco cria a próxima com os mesmos responsáveis
- [x] Painel da tarefa com chat (mensagens não podem ser editadas nem apagadas, travado no banco);
      prioridades só Urgente e Importante; sem descrição e sem subtarefas por enquanto
- [x] Link da pasta (OneDrive/SharePoint/Drive) na lista e na tarefa; links clicáveis no chat
- [x] Listas de campanha: resultados por tarefa separados em Google e Meta (impressões, cliques, CPC calculado,
      valor gasto), colunas na lista, resumo no topo e quadro no painel da tarefa
- [x] Listas de conteúdo: post com texto, imagem/vídeo, tipo e data; publica ou agenda pelo GHL (Social Planner)
      em Instagram, Facebook, TikTok, LinkedIn e YouTube; link e métricas por rede, atualizadas por robô diário
- [ ] Importar resultados automaticamente do Google Ads e do Meta Ads
- [ ] Folders na sidebar, convite por link
- [ ] Fase 3: Custom Fields (`custom_fields` + `task_custom_values` jsonb)
- [x] Calendário (por lista e em Minhas tarefas), com arrastar para mudar o prazo
- [ ] Fase 4: views Tabela e Gantt; filtros salvos
- [ ] Fase 5: automações ("quando status = X, faça Y"), histórico de atividade
