import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown, ArrowLeft, ArrowRight, Boxes, CalendarClock, Check,
  CircleDot, Globe2, Layers3, ScanBarcode, Target, UtensilsCrossed, Wallet,
} from 'lucide-react';
import { useAuth } from '@/store/auth';
import { dadosPendentes, diferenciais, etapas, expansao, pilares, prioridadesAporte } from '@/content/investidores';

const iconesPilares = [UtensilsCrossed, ScanBarcode, Boxes, CalendarClock, Wallet];
const navegacao = [
  ['produto', 'O produto'], ['evolucao', 'Nosso futuro'],
  ['receita', 'Modelo de receita'], ['aporte', 'O investimento'],
];
const foco = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500';

function TituloSecao({ numero, titulo, descricao }: { numero: string; titulo: string; descricao?: string }) {
  return <div className="mb-8 max-w-3xl">
    <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-brand-600">{numero}</p>
    <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">{titulo}</h2>
    {descricao && <p className="mt-4 text-base leading-relaxed text-slate-600">{descricao}</p>}
  </div>;
}

export default function InvestidoresPage() {
  const autenticado = useAuth((state) => Boolean(state.token));

  useEffect(() => {
    const tituloAnterior = document.title;
    document.title = 'SimplesX | Apresentação aos investidores';
    if (!window.location.hash) window.scrollTo(0, 0);
    else document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
    return () => { document.title = tituloAnterior; };
  }, []);

  return <div className="min-h-screen bg-slate-50 text-slate-800">
    <a href="#apresentacao" className={`sr-only z-50 rounded-lg bg-white p-3 text-brand-700 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 ${foco}`}>Pular para a apresentação</a>
    <header className="border-b border-white/10 bg-slate-950 text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link to={autenticado ? '/' : '/login'} aria-label="SimplesX — voltar ao sistema" className={`flex items-center gap-3 rounded-lg ${foco}`}>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-xl font-extrabold">S</span>
          <span className="text-lg font-extrabold tracking-tight">SimplesX</span>
        </Link>
        <Link to={autenticado ? '/' : '/login'} className={`inline-flex items-center gap-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white ${foco}`}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Voltar ao sistema
        </Link>
      </div>
    </header>

    <main id="apresentacao">
      <section className="overflow-hidden bg-gradient-to-br from-slate-950 via-brand-950 to-slate-900 text-white">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:py-20">
          <div>
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand-400/30 bg-brand-400/10 px-3 py-1.5 text-xs font-semibold text-brand-200"><CircleDot className="h-3.5 w-3.5" aria-hidden="true" /> Apresentação aos investidores</p>
            <h1 className="text-4xl font-extrabold leading-[1.12] tracking-tight sm:text-5xl">Gestão completa.<br />Operação simples.<br /><span className="text-brand-300">Tudo conectado.</span></h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-300 sm:text-lg">Começamos pela gestão diária de restaurantes e mercados. Nossa visão é evoluir para um super aplicativo que conecte o comércio a pedidos online, profissionais e agendamentos.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#produto" className={`inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-brand-900 hover:bg-brand-50 ${foco}`}>Conheça o produto <ArrowDown className="h-4 w-4" aria-hidden="true" /></a>
              <a href="#aporte" className={`inline-flex items-center gap-2 rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10 ${foco}`}>Destino do investimento <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
            </div>
            <div className="mt-9 border-l-2 border-brand-400 pl-4 text-sm"><p className="font-semibold">Brendo Myranda</p><p className="mt-1 text-slate-400">CEO</p></div>
          </div>

          <div className="rounded-3xl border border-white/15 bg-white/5 p-5 shadow-2xl sm:p-7">
            <div className="mb-5 flex items-center justify-between gap-3"><p className="text-xs font-bold uppercase tracking-widest text-brand-200">Nossa trajetória de produto</p><Layers3 className="h-5 w-5 text-brand-300" aria-hidden="true" /></div>
            <div className="rounded-2xl bg-white p-5 text-slate-900">
              <p className="text-xs font-bold uppercase tracking-wider text-brand-600">Base atual</p>
              <p className="mt-2 text-xl font-extrabold">5 pilares de gestão</p>
              <div className="mt-4 flex flex-wrap gap-2">{['Pedidos', 'Vendas', 'Estoque', 'Validade', 'Financeiro'].map((item) => <span key={item} className="rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-800">{item}</span>)}</div>
              <p className="mt-4 text-sm text-slate-500">Foco inicial em restaurantes e mercados.</p>
            </div>
            <div className="flex items-center gap-3 px-5 py-4 text-xs text-brand-200"><ArrowDown className="h-5 w-5" aria-hidden="true" /> Consolidar, integrar e validar</div>
            <div className="rounded-2xl border border-dashed border-brand-300/40 p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-brand-300">Visão de longo prazo</p>
              <p className="mt-2 text-xl font-bold">Um super app para o comércio</p>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">Marketplace · Freelancers · Agendamentos</p>
              <p className="mt-3 text-xs text-slate-400">Módulos planejados para a expansão futura.</p>
            </div>
          </div>
        </div>
      </section>

      <nav aria-label="Seções da apresentação" className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 py-3 sm:gap-4 sm:px-8">
          {navegacao.map(([id, label]) => <a key={id} href={`#${id}`} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-brand-50 hover:text-brand-700 ${foco}`}>{label}</a>)}
        </div>
      </nav>

      <div className="mx-auto max-w-6xl space-y-16 px-5 py-14 sm:space-y-20 sm:px-8 sm:py-20">
        <section aria-labelledby="proposta-titulo" className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-brand-600">A proposta</p>
            <h2 id="proposta-titulo" className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">As informações essenciais do comércio, na palma da mão.</h2>
            <p className="mt-5 leading-relaxed text-slate-600">A SimplesX reúne pedidos, vendas, estoque, validade e controle financeiro em uma experiência integrada, com uma interface intuitiva e recursos para apoiar o trabalho diário.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
            <h3 className="font-bold text-slate-900">O problema que queremos resolver</h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">Quando vendas, produtos, vencimentos e movimentações financeiras ficam espalhados, entender a operação, treinar profissionais e tomar decisões se torna mais difícil.</p>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">Nossa hipótese é que uma experiência integrada e uma cobrança previsível gerem valor para o comerciante. Vamos demonstrar esse valor com dados de uso, retenção e resultados dos clientes.</p>
          </div>
        </section>

        <section id="produto" className="scroll-mt-24">
          <TituloSecao numero="01 / Onde estamos" titulo="Cinco pilares em uma mesma plataforma" descricao="O foco inicial está em restaurantes e mercados, alinhado às funcionalidades existentes no produto." />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pilares.map((pilar, index) => {
              const Icone = iconesPilares[index];
              return <article key={pilar.id} className={`rounded-2xl border border-slate-200 bg-white p-6 ${index === 4 ? 'lg:col-span-2' : ''}`}>
                <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Icone className="h-5 w-5" aria-hidden="true" /></div>
                <h3 className="font-bold text-slate-900">{pilar.titulo}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{pilar.recursos}</p>
                <p className="mt-5 border-t border-slate-100 pt-4 text-sm leading-relaxed text-brand-800">{pilar.beneficio}</p>
              </article>;
            })}
          </div>
          <p className="mt-5 text-xs leading-relaxed text-slate-500">Estágio descrito pelo fundador. Métricas de uso e resultados comerciais ainda serão acrescentados. Os indicadores de CMV e lucro devem ser demonstrados com suas regras de cálculo e os custos considerados.</p>
          <div className="mt-8 rounded-2xl bg-slate-100 p-6">
            <h3 className="text-sm font-bold text-slate-900">Um público inicial claro, com espaço para expansão</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">Padarias e açougues são extensões previstas com a integração de balanças. Barbearias e outros negócios que trabalham com horários entram na visão futura de agendamentos.</p>
          </div>
        </section>

        <section aria-labelledby="diferenciais-titulo">
          <h2 id="diferenciais-titulo" className="text-xl font-extrabold tracking-tight text-slate-900">O que pretendemos entregar de diferente</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {diferenciais.map((item) => <div key={item.titulo} className="border-l-2 border-brand-200 pl-4"><h3 className="text-sm font-bold text-slate-900">{item.titulo}</h3><p className="mt-2 text-sm leading-relaxed text-slate-600">{item.texto}</p></div>)}
          </div>
          <p className="mt-6 text-xs leading-relaxed text-slate-500">Diferenciais propostos, a comprovar com demonstrações, comparação de funcionalidades e evidências dos clientes.</p>
        </section>

        <section id="evolucao" className="scroll-mt-24">
          <TituloSecao numero="02 / Aonde queremos chegar" titulo="Crescer por etapas, com marcos para avançar" descricao="A expansão começa pela consolidação da gestão e avança conforme as integrações e a demanda forem validadas." />
          <ol className="grid gap-4 md:grid-cols-2">
            {etapas.map((etapa, index) => <li key={etapa.titulo} className="relative rounded-2xl border border-slate-200 bg-white p-6 sm:p-7">
              <div className="mb-5 flex items-center justify-between gap-4"><span className="text-3xl font-extrabold tracking-tight text-brand-200">0{index + 1}</span><span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">{etapa.status}</span></div>
              <h3 className="text-lg font-bold text-slate-900">{etapa.titulo}</h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">{etapa.escopo}</p>
              <div className="mt-5 rounded-xl bg-slate-50 p-4"><p className="flex items-center gap-2 text-xs font-bold text-slate-700"><Target className="h-4 w-4 text-brand-500" aria-hidden="true" /> Marco para avançar</p><p className="mt-2 text-sm leading-relaxed text-slate-600">{etapa.marco}</p></div>
            </li>)}
          </ol>
          <p className="mt-5 text-xs leading-relaxed text-slate-500">Plano proposto, ainda sem datas ou orçamento definidos. Marketplace, freelancers e agendamentos são módulos futuros.</p>
          <div className="mt-10 rounded-3xl bg-slate-900 p-6 text-white sm:p-9">
            <div className="flex items-center gap-3"><Globe2 className="h-6 w-6 text-brand-300" aria-hidden="true" /><h3 className="text-xl font-bold">A visão de um comércio conectado</h3></div>
            <div className="mt-7 grid gap-7 lg:grid-cols-3">{expansao.map((item) => <div key={item.titulo}><h4 className="text-sm font-bold text-brand-200">{item.titulo}</h4><p className="mt-3 text-sm leading-relaxed text-slate-300">{item.texto}</p></div>)}</div>
          </div>
        </section>

        <section id="receita" className="scroll-mt-24">
          <TituloSecao numero="03 / Modelo de negócio" titulo="Receita recorrente e serviços opcionais" descricao="O modelo proposto combina assinatura mensal da plataforma e impulsionamento opcional no marketplace futuro." />
          <div className="grid gap-5 md:grid-cols-2">
            <article className="rounded-2xl border border-brand-200 bg-brand-50 p-6 sm:p-8">
              <p className="text-xs font-bold uppercase tracking-wider text-brand-600">Receita principal prevista</p>
              <h3 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-900">Assinatura mensal</h3>
              <p className="mt-4 text-sm leading-relaxed text-slate-600">Uma mensalidade fixa e acessível para usar a plataforma, independentemente do porte do estabelecimento.</p>
              <p className="mt-4 text-sm leading-relaxed text-slate-600">Preço, limites de utilização e módulos incluídos ainda precisam ser definidos e validados em relação aos custos de infraestrutura, suporte e atendimento.</p>
              <p className="mt-6 inline-flex rounded-lg bg-white px-3 py-2 text-xs font-bold text-brand-700">Preço e escopo comercial em definição</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Receita complementar futura</p>
              <h3 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-900">Impulsionamento opcional</h3>
              <p className="mt-4 text-sm leading-relaxed text-slate-600">Destaque contratado pelos estabelecimentos no marketplace, separado da mensalidade. A regra proposta limita cada loja a duas vezes por semana, buscando ampliar a rotatividade dos espaços.</p>
              <p className="mt-4 text-sm leading-relaxed text-slate-600">Estão previstas ofertas diárias para lojas elegíveis. Preço, duração, vagas e critérios de distribuição serão definidos; a eficácia da regra será avaliada no piloto, sem promessa antecipada de aumento de vendas ou equilíbrio de exposição.</p>
            </article>
          </div>
        </section>

        <section id="aporte" className="scroll-mt-24">
          <TituloSecao numero="04 / Por que buscamos investimento" titulo="Transformar a base atual em crescimento validado" descricao="Buscamos consolidar o produto, estruturar a aquisição e o atendimento de clientes e validar a expansão para pedidos online. O aporte deve estar ligado a entregas mensuráveis." />
          <div className="grid gap-8 lg:grid-cols-[1.15fr_1fr]">
            <div className="space-y-6">
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Prioridades para aplicação do aporte</h3>
              {prioridadesAporte.map((item) => <div key={item.titulo} className="flex gap-4"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-600"><Check className="h-3.5 w-3.5" aria-hidden="true" /></span><div><h4 className="font-bold text-slate-900">{item.titulo}</h4><p className="mt-2 text-sm leading-relaxed text-slate-600">{item.texto}</p></div></div>)}
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
              <h3 className="text-lg font-bold text-slate-900">Condições da proposta</h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">A apresentação mostra o produto e a direção da empresa. Os termos da captação ainda serão completados.</p>
              <dl className="mt-6 divide-y divide-slate-100 text-sm">{['Valor do investimento buscado', 'Modalidade e condições', 'Orçamento e prazos', 'Metas de execução'].map((label) => <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3"><dt className="text-slate-600">{label}</dt><dd className="font-semibold text-brand-700">Em definição</dd></div>)}</dl>
            </div>
          </div>
          <details className="group mt-10 rounded-2xl border border-slate-200 bg-white">
            <summary className={`cursor-pointer rounded-2xl p-6 text-sm font-bold text-slate-800 ${foco}`}>Dados a complementar para a proposta definitiva</summary>
            <div className="border-t border-slate-100 px-6 pb-6 pt-5">
              <p className="mb-6 text-sm leading-relaxed text-slate-600">Esses dados ainda não foram apresentados e serão acrescentados para permitir uma avaliação com resultados verificáveis.</p>
              <dl className="grid gap-6 sm:grid-cols-2">{dadosPendentes.map((item) => <div key={item.titulo}><dt className="text-sm font-bold text-slate-900">{item.titulo}</dt><dd className="mt-2 text-sm leading-relaxed text-slate-600">{item.texto}</dd></div>)}</dl>
            </div>
          </details>
        </section>

        <section className="rounded-3xl bg-gradient-to-br from-brand-950 to-slate-900 p-7 text-white sm:p-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-300">Nossa visão</p>
          <h2 className="mt-4 max-w-3xl text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">Começar pela gestão diária. Ampliar as possibilidades do comércio.</h2>
          <p className="mt-5 max-w-3xl leading-relaxed text-slate-300">Cinco pilares funcionais, com foco em restaurantes e mercados. O próximo passo é consolidar a operação, ampliar as integrações e validar um marketplace conectado à gestão. Queremos desenvolver essa expansão com metas mensuráveis e valor demonstrado aos clientes.</p>
          <a href="#apresentacao" className={`mt-7 inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-brand-200 hover:text-white ${foco}`}>Voltar ao início da apresentação <ArrowRight className="h-4 w-4" aria-hidden="true" /></a>
        </section>
      </div>
    </main>
    <footer className="border-t border-slate-200 bg-white px-5 py-7 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-xs text-slate-500"><p><strong className="text-slate-800">SimplesX</strong> · Apresentação aos investidores</p><p>Brendo Myranda — CEO</p></div>
    </footer>
  </div>;
}
