import { ArrowUpRight, Bike, LayoutDashboard, Store } from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import './portal.css';

const DESTINOS = [
  {
    titulo: 'Marketplace DoixP',
    descricao: 'Encontre restaurantes e faça seu pedido em um só lugar.',
    acao: 'Acessar marketplace',
    href: '/pedido',
    icon: Store,
    classe: 'portal-card-marketplace',
  },
  {
    titulo: 'Gestor DoixP',
    descricao: 'Acesse vendas, estoque, financeiro e a operação do seu estabelecimento.',
    acao: 'Entrar no gestor',
    href: '/gestor',
    icon: LayoutDashboard,
    classe: 'portal-card-gestor',
  },
];

export function PortalPage() {
  return (
    <main className="portal-page">
      <div className="portal-shell">
        <header className="portal-header">
          <a href="/" className="portal-brand" aria-label="DoixP início">
            <BrandLogo alt="DoixP" className="h-12 w-12" />
            <span>DoixP</span>
          </a>
          <span className="portal-header-note">Uma plataforma para conectar negócios e pessoas</span>
        </header>

        <section className="portal-intro" aria-labelledby="portal-title">
          <p className="portal-eyebrow">BEM-VINDO À DOIXP</p>
          <h1 id="portal-title">O que você quer acessar?</h1>
          <p>Escolha uma das experiências DoixP para continuar.</p>
        </section>

        <section className="portal-destinos" aria-label="Aplicações DoixP">
          {DESTINOS.map(({ titulo, descricao, acao, href, icon: Icon, classe }) => (
            <a key={href} className={`portal-card ${classe}`} href={href}>
              <span className="portal-card-icon"><Icon aria-hidden="true" /></span>
              <span className="portal-card-copy">
                <strong>{titulo}</strong>
                <span>{descricao}</span>
              </span>
              <span className="portal-card-action">{acao}<ArrowUpRight aria-hidden="true" /></span>
            </a>
          ))}

          <button className="portal-card portal-card-delivery" type="button" disabled aria-labelledby="portal-delivery-title">
            <span className="portal-card-icon"><Bike aria-hidden="true" /></span>
            <span className="portal-card-copy">
              <strong id="portal-delivery-title">DoixP Entregas</strong>
              <span>Em breve, uma nova forma de conectar lojas, clientes e entregadores.</span>
            </span>
            <span className="portal-coming-soon">Em breve</span>
          </button>
        </section>

        <footer className="portal-footer">DoixP · Tecnologia para simplificar o dia a dia</footer>
      </div>
    </main>
  );
}
