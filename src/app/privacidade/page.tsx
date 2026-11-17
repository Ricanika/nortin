import type { Metadata } from "next";

export const metadata: Metadata = { title: "Política de Privacidade · Hyak Group" };

// Página pública (sem login): exigida pela Meta para o app de integração ficar "Ao vivo".
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-6 py-10 text-slate-700">
      <h1 className="text-2xl font-bold text-slate-900">Política de Privacidade</h1>
      <p className="text-sm text-slate-500">Hyak Group · última atualização: novembro de 2026</p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">1. O que é este aplicativo</h2>
        <p>
          O Hyak Group (hyakgroup.vercel.app) é uma ferramenta interna de gestão de tarefas e de conteúdo das marcas do grupo
          (Nitron, Teak Brazil, Roga Village e Mood Fruits), usada apenas pela equipe interna.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">2. Dados que coletamos</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Da equipe: nome e e-mail usados para entrar e para atribuir tarefas.</li>
          <li>
            Das redes sociais das próprias marcas do grupo (Facebook e Instagram, via Meta): apenas métricas agregadas dos posts
            publicados pelas marcas, como alcance, visualizações, curtidas, comentários e compartilhamentos.
          </li>
          <li>Não coletamos dados pessoais de seguidores, clientes ou de qualquer outro usuário das redes sociais.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">3. Como usamos</h2>
        <p>
          Os dados servem só para acompanhar o desempenho do conteúdo publicado pelas marcas e organizar o trabalho da equipe.
          Não vendemos, não compartilhamos com terceiros e não usamos para publicidade.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">4. Onde ficam guardados</h2>
        <p>
          Em servidores de infraestrutura contratada (Supabase e Vercel), com acesso restrito à equipe autorizada. As chaves de
          acesso às redes ficam guardadas de forma protegida no servidor e nunca são exibidas.
        </p>
      </section>

      <section id="exclusao" className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">5. Exclusão de dados</h2>
        <p>
          Para pedir a exclusão dos seus dados ou desconectar uma conta, envie um e-mail para o administrador do Hyak Group
          informando o nome da conta. A exclusão é feita em até 30 dias. Também é possível remover o acesso do aplicativo a
          qualquer momento nas configurações de “Integrações comerciais” do Facebook.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">6. Contato</h2>
        <p>Dúvidas sobre esta política: fale com o administrador do Hyak Group.</p>
      </section>
    </main>
  );
}
