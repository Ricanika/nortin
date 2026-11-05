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
5. Opcional para desenvolvimento: em Authentication → Providers → Email, desligue
   "Confirm email" para entrar logo após o cadastro.
6. Suba o app:
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
- [ ] Folders na sidebar, convite por link
- [ ] Fase 3: Custom Fields (`custom_fields` + `task_custom_values` jsonb)
- [x] Calendário (por lista e em Minhas tarefas), com arrastar para mudar o prazo
- [ ] Fase 4: views Tabela e Gantt; filtros salvos
- [ ] Fase 5: automações ("quando status = X, faça Y"), histórico de atividade
