export const CATEGORIAS_DELIVERY = [
  { busca: 'promocao', nome: 'Promoção', aliases: ['promocao', 'promocoes', 'ofertas'] },
  { busca: 'lanches', nome: 'Lanches', aliases: ['lanches', 'lanche', 'hamburgueres', 'hamburguer', 'hamburgueria'] },
  { busca: 'pizza', nome: 'Pizza', aliases: ['pizza', 'pizzas', 'pizzaria'] },
  { busca: 'acai', nome: 'Açaí', aliases: ['acai', 'acais', 'acaiteria'] },
  { busca: 'marmitas', nome: 'Marmitas', aliases: ['marmitas', 'marmita', 'marmitex'] },
];

export function categoriaPrincipalDelivery(value) {
  const busca = String(value || '').normalize('NFD').replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  return CATEGORIAS_DELIVERY.find((categoria) => categoria.aliases.includes(busca))?.busca || busca;
}
