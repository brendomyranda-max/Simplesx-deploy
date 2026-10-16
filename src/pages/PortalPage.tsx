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
          <p>Conectamos pessoas e comércios com tecnologia simples para comprar, vender e crescer.</p>
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
            <p className="portal-eyebrow">NOSSA HISTÓRIA</p>
            <h2 id="portal-story-title">Uma ideia simples: aproximar.</h2>
            <p>A DoixP nasceu para tornar mais fácil a conexão entre quem procura e quem oferece.</p>
          </div>

          <div className="portal-story-grid">
            <article>
              <h3>Quem somos</h3>
              <p>Somos uma plataforma que conecta consumidores e comércios em uma experiência digital acessível.</p>
            </article>
            <article>
              <h3>O que fazemos</h3>
              <p>Reunimos compras no Marketplace e ferramentas de gestão para apoiar o dia a dia dos estabelecimentos.</p>
            </article>
            <article>
              <h3>Onde queremos chegar</h3>
              <p>Queremos crescer junto com nossos parceiros e criar novas formas de conectar lojas, clientes e entregadores.</p>
            </article>
          </div>
        </section>

        <footer className="portal-footer">DoixP · Feita para conectar e simplificar</footer>
      </div>
    </main>
  );
}
