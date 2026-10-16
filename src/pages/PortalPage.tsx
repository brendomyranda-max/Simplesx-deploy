import { ArrowUpRight } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import './portal.css';

const ACESSOS = [
  {
    titulo: 'COMPRAS',
    descricao: 'Comprar na DoixP',
    href: '/pedido',
  },
  {
    titulo: 'GESTOR',
    descricao: 'Gestor DoixP para o seu comércio',
    href: '/gestor',
  },
];

export function PortalPage() {
  return (
    <main className="portal-page">
      <div className="portal-shell">
        <header className="portal-header">
          <a href="/" className="portal-brand" aria-label="DoixP início">
            <BrandLogo alt="" className="h-10 w-10" />
            <span>DoixP</span>
          </a>
          <span className="portal-header-note">Tecnologia que aproxima</span>
        </header>

        <section className="portal-intro" aria-labelledby="portal-title">
          <p className="portal-eyebrow">BEM-VINDO À DOIXP</p>
          <h1 id="portal-title">Obrigado por fazer parte dessa história.</h1>
          <p>Mais praticidade para quem compra, mais controle para quem vende e mais valor para quem entrega.</p>
        </section>

        <nav className="portal-destinos" aria-label="Acessos DoixP">
          {ACESSOS.map(({ titulo, descricao, href }) => (
            <div className="portal-destino" key={href}>
              <a className="portal-button" href={href}>
                <span>{titulo}</span>
                <ArrowUpRight aria-hidden="true" />
              </a>
              <p>{descricao}</p>
            </div>
          ))}

          <div className="portal-destino">
            <button className="portal-button portal-button-disabled" type="button" disabled>
              <span>DOIXP ENTREGAS</span>
              <span className="portal-coming-soon">EM BREVE</span>
            </button>
            <p>Seja um Parceiro</p>
          </div>
        </nav>

        <section className="portal-story" aria-labelledby="portal-story-title">
          <div className="portal-story-heading">
            <p className="portal-eyebrow">NOSSA PROPOSTA</p>
            <h2 id="portal-story-title">Com a DoixP, todo mundo ganha.</h2>
            <p>Reunir consumidores, comércios e entregadores em um só lugar, com tecnologia simples e uma relação mais justa para todos.</p>
          </div>

          <div className="portal-story-grid">
            <article>
              <h3>Quem somos</h3>
              <p>A DoixP nasceu para aproximar quem compra, quem vende e quem entrega. Acreditamos que a tecnologia deve facilitar o trabalho e valorizar cada pessoa que faz parte dessa relação.</p>
              <p>Nossa proposta para os estabelecimentos é uma mensalidade fixa, sem comissão sobre as vendas e sem cobrança por pedido. O resultado de cada venda fica com quem trabalha por ele.</p>
            </article>
            <article>
              <h3>O que a DoixP entrega</h3>
              <p>As ferramentas da sua operação reunidas em um só sistema, do atendimento ao controle do negócio.</p>
              <ul>
                <li>Controle de estoque, vendas, perdas e despesas.</li>
                <li>Acompanhamento de validade e impressão de etiquetas.</li>
                <li>Observações prontas para agilizar o atendimento.</li>
                <li>Comandas individuais por nome ou cartão NFC.</li>
                <li>Pedidos online e navegação organizada.</li>
              </ul>
            </article>
            <article>
              <h3>Onde queremos chegar</h3>
              <p>Queremos conectar toda essa experiência à <strong>DoixP Entregas, que está em desenvolvimento</strong>. A proposta é que o entregador receba 100% do valor das suas entregas, sem comissão da DoixP.</p>
              <p>Valorizar esse trabalho é incentivar um atendimento cuidadoso e construir uma experiência melhor para o consumidor, o comércio e o entregador.</p>
            </article>
          </div>
        </section>

        <section className="portal-history" aria-labelledby="portal-history-title">
          <div>
            <p className="portal-eyebrow">NOSSA HISTÓRIA</p>
            <h2 id="portal-history-title">Uma ideia que nasceu na rotina do atendimento.</h2>
          </div>
          <div className="portal-history-text">
            <p>Durante seis anos trabalhando como garçom e bartender, o fundador da DoixP conheceu diferentes sistemas e viveu de perto os desafios de uma operação: informações espalhadas, tarefas repetidas e ferramentas que nem sempre conversavam entre si.</p>
            <p>Foi dessa experiência que nasceu a DoixP, com o objetivo de reunir o que um estabelecimento precisa em uma plataforma simples, eficaz e cada vez mais completa.</p>
            <p>Acompanhar a validade antes que um produto se perca. Imprimir etiquetas com praticidade. Agilizar pedidos com observações prontas. Organizar comandas e ter mais clareza sobre o estoque e as finanças. São melhorias pensadas por quem conhece o ritmo do balcão e do salão.</p>
            <p className="portal-history-closing">Nosso compromisso é evoluir junto com quem usa a DoixP e tornar o trabalho de todos mais simples, todos os dias.</p>
          </div>
        </section>

        <footer className="portal-footer">DoixP · Com a DoixP, todo mundo ganha.</footer>
      </div>
    </main>
  );
}
