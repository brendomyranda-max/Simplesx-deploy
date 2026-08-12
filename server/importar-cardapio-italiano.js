const BASE = process.env.SIMPLESX_URL || 'https://simplesx-projeto-beta.pages.dev/api';
const acesso = process.env.SIMPLESX_TOKEN;
const usuario = process.env.SIMPLESX_USUARIO;
const senha = process.env.SIMPLESX_SENHA;
if (!acesso || !usuario || !senha) throw new Error('Defina SIMPLESX_TOKEN, SIMPLESX_USUARIO e SIMPLESX_SENHA');

async function requisicao(path, method = 'GET', body, sessao = '') {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(sessao ? { authorization: `Bearer ${sessao}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path}: ${data.error || r.status}`);
  return data;
}

const insumos = [
  ['Massa artesanal fresca', 'KG', 18, 'Mercearia'], ['Massa recheada fresca', 'KG', 32, 'Mercearia'],
  ['Massa vegana de pupunha', 'KG', 28, 'Hortifruti'], ['Molho de tomate', 'KG', 9, 'Mercearia'],
  ['Arroz branco', 'KG', 7, 'Mercearia'], ['Arroz arbóreo', 'KG', 30, 'Mercearia'],
  ['Farinha de trigo', 'KG', 6, 'Mercearia'], ['Farinha de rosca', 'KG', 10, 'Mercearia'],
  ['Azeite de oliva', 'L', 48, 'Mercearia'], ['Óleo de cozinha', 'L', 9, 'Mercearia'],
  ['Leite integral', 'L', 5.35, 'Laticínios'], ['Creme de leite', 'L', 18, 'Laticínios'],
  ['Manteiga', 'KG', 45, 'Laticínios'], ['Muçarela', 'KG', 32.9, 'Laticínios'],
  ['Muçarela de búfala', 'KG', 75, 'Laticínios'], ['Parmesão', 'KG', 58.9, 'Laticínios'],
  ['Gorgonzola', 'KG', 68.9, 'Laticínios'], ['Provolone', 'KG', 45, 'Laticínios'],
  ['Catupiry', 'KG', 45, 'Laticínios'], ['Ricota', 'KG', 28, 'Laticínios'],
  ['Ovo', 'UN', 1, 'Laticínios'], ['Filé mignon', 'KG', 109.9, 'Proteínas'],
  ['Carne moída', 'KG', 49.99, 'Proteínas'], ['Peito de frango', 'KG', 31.9, 'Proteínas'],
  ['Salmão', 'KG', 129.9, 'Pescados'], ['Linguado', 'KG', 99.9, 'Pescados'],
  ['Congrio', 'KG', 79.9, 'Pescados'], ['Camarão limpo', 'KG', 95, 'Pescados'],
  ['Lula', 'KG', 58, 'Pescados'], ['Mix frutos do mar', 'KG', 72, 'Pescados'],
  ['Bacalhau', 'KG', 120, 'Pescados'], ['Siri', 'KG', 65, 'Pescados'],
  ['Pernil de vitela', 'KG', 75, 'Proteínas'], ['Cordeiro', 'KG', 89.9, 'Proteínas'],
  ['Língua bovina', 'KG', 32, 'Proteínas'], ['Bacon', 'KG', 36, 'Proteínas'],
  ['Calabresa', 'KG', 35.9, 'Proteínas'], ['Presunto', 'KG', 30, 'Proteínas'],
  ['Presunto de Parma', 'KG', 120, 'Proteínas'], ['Pão italiano', 'KG', 22, 'Mercearia'],
  ['Batata', 'KG', 5, 'Hortifruti'], ['Batata palha', 'KG', 30, 'Mercearia'],
  ['Tomate', 'KG', 7, 'Hortifruti'], ['Tomate seco', 'KG', 55, 'Hortifruti'],
  ['Cebola', 'KG', 6.5, 'Hortifruti'], ['Alho', 'KG', 30, 'Hortifruti'],
  ['Cenoura', 'KG', 4.8, 'Hortifruti'], ['Brócolis', 'KG', 14, 'Hortifruti'],
  ['Espinafre', 'KG', 16, 'Hortifruti'], ['Folhas verdes', 'KG', 20, 'Hortifruti'],
  ['Rúcula', 'KG', 24, 'Hortifruti'], ['Palmito', 'KG', 42, 'Hortifruti'],
  ['Berinjela', 'KG', 8, 'Hortifruti'], ['Pimentão', 'KG', 12, 'Hortifruti'],
  ['Ervilha', 'KG', 14, 'Hortifruti'], ['Champignon', 'KG', 32, 'Hortifruti'],
  ['Aspargo', 'KG', 48, 'Hortifruti'], ['Alcachofra', 'KG', 55, 'Hortifruti'],
  ['Funghi seco', 'KG', 180, 'Hortifruti'], ['Manjericão e ervas', 'KG', 55, 'Hortifruti'],
  ['Nozes e castanhas', 'KG', 65, 'Mercearia'], ['Frutas variadas', 'KG', 12, 'Hortifruti'],
  ['Banana', 'KG', 7, 'Hortifruti'], ['Abacaxi', 'KG', 8, 'Hortifruti'],
  ['Leite de coco', 'L', 18, 'Mercearia'], ['Açúcar', 'KG', 5, 'Mercearia'],
  ['Chocolate', 'KG', 45, 'Mercearia'], ['Sorvete de creme', 'L', 28, 'Laticínios'],
  ['Café', 'KG', 58, 'Bebidas e bar'], ['Temperos e molhos', 'KG', 25, 'Mercearia'],
];

const pratos = [];
const add = (categoria, nome, preco, descricao = '') => pratos.push({ categoria, nome, preco, descricao });
const varios = (categoria, itens) => itens.forEach((i) => add(categoria, ...i));

varios('Entradas', [
  ['Couvert (serve 2 pessoas)',50,'Pão italiano, manteiga, sardela, azeitonas, berinjela e muçarela de búfala'],
  ['Torrada de Alho',45,'10 fatias de pão italiano com pasta de alho'], ['Bruschetta Especial',50,'Tomate, muçarela e orégano; 10 unidades'],
  ['Torrada de Gorgonzola',45,'10 unidades'], ['Trittico de Torradas',70,'Mix de alho, gorgonzola e bruschetta; 9 unidades'],
  ['Provolone à Milanesa',45], ['Carpaccio Luchesi',60,'Carpaccio, rúcula e torradas de alho'],
  ['Carpaccio de Prosciutto di Parma',90], ['Carpaccio de Salmão',75], ['Lulas Infarinatas Fritas',69,'Com molho tártaro'],
  ['Sardela',30], ['Bolinho de Bacalhau',80], ['Frios à Piero',100], ['Muçarela de Búfala - Unidade',18], ['Casquinha de Siri - Unidade',25],
]);

const saladas = [
  ['Piero',[45,75,100],'Folhas, erva-doce, tomate, palmito, berinjela, pimentão e torradas'],
  ['Mangiare Felice',[47,79,110],'Tomate, palmito, erva-doce, cebola, cenoura, brócolis, berinjela e pimentão'],
  ['Completa',[39,65,89],'Folhas, tomate, erva-doce, palmito e torradas'], ['Mista',[33,55,79],'Folhas, erva-doce, tomate e palmito'],
  ['Caprese',[41,69,89],'Tomate, muçarela de búfala, rúcula, tomate seco e manjericão'],
  ['Frutos do Mar a Modo Mio',[100,170,220],'Alface, tomate, cebola, ervilha, lula, vôngoli, marisco e camarões'],
];
saladas.forEach(([n, ps, d]) => ps.forEach((p, i) => add('Saladas', `${n} - ${[1,2,4][i]} pessoa${i ? 's' : ''}`, p, d)));

['Dó|Filé de frango, purê e arroz','Ré|Filé mignon, arroz, fritas e ovo','Mi|Frango e tagliarini na manteiga','Fá|Massa à bolonhesa','Sol|Capeletti ao molho rosado','Lá|Iscas de frango com legumes','Si|Iscas de filé com gnocchi 4 queijos']
  .forEach((x) => { const [n,d]=x.split('|'); add('Bambino',`Piatto Bambino ${n}`,50,d); });
[['Fratello',55,65],['Pomodoro',45,55],['Ragazzo',55,65],['Pesto',50,null]].forEach(([m,sp,la]) => {
  add('Vegano',`Spaghetti de Pupunha ${m}`,sp,'Massa vegana de pupunha'); if (la) add('Vegano',`Lasagna de Pupunha ${m}`,la,'Berinjela, abobrinha, funghi, nozes e pupunha');
});

varios('Massas', [
  ['Massa Mangiare Felice',210,'Quatro queijos, mignon à milanesa, sugo e muçarela'], ['Massa Del Capo',270,'Molho branco, funghi, quatro escalopes e parmesão'],
  ['Massa Alla Trovata',180,'Quatro queijos, tomate seco, frango e rúcula'], ['Massa Alfredo di Roma',180,'Molho branco, champignon e funghi'],
  ['Massa Marina',200,'Espinafre, nozes, passas, gorgonzola e Catupiry'], ['Massa Alla Creme Especial',180,'Quatro queijos e espinafre'],
  ['Massa Carbonara',140,'Molho branco, gema, bacon e parmesão'], ['Massa Camaresca',220,'Molho branco, camarões, champignon e Catupiry'],
  ['Massa 4 Formaggi',180,'Gorgonzola, parmesão, provolone e Catupiry'], ['Massa Alla Panna',190,'Molho branco e funghi'],
  ['Massa Nonno',195,'Quatro queijos, mignon, tomate seco, azeitona e rúcula'], ['Massa ao Molho Branco',140], ['Massa ao Catupiry',150],
  ['Massa Barbosa 2',195,'Quatro queijos, espinafre, vitela e muçarela de búfala'], ['Massa Piero no Azeite',160,'Berinjela, pimentão, mignon, tomate e champignon'],
  ['Massa Zamparetti',220,'Camarões, alho, cebola, ervas, azeite e parmesão'], ['Massa Di Capri',220,'Berinjela, camarões, pimentão e tomate'],
  ['Massa Alle Paglia e Feno',230,'Brócolis, camarão, vôngoli e champignon'], ['Massa Como Eu Gosto',140,'Molho rosado e muçarela'],
  ['Massa Moda da Casa',150,'Molho rosado, bacon e Catupiry'], ['Massa Moda do Chefe',199,'Molho rosado, funghi, Parma e tomate seco'],
  ['Massa Braulio',150,'Molho rosado, bacon, braciola e Catupiry'], ['Massa Dino Zoff',200,'Molho rosado, champignon, gorgonzola e Catupiry'],
  ['Massa Primi',140,'Napolitana, ervas e muçarela de búfala'], ['Massa Italiana',160,'Napolitana, alho, mignon e manjericão'],
  ['Massa Veneziana',160,'Napolitana, mignon e muçarela de búfala'], ['Massa à Bolognesa',150,'Tomate e carne moída'],
  ['Massa Da Sorella',200,'Napolitana, tomate seco, alcachofra, funghi e quatro queijos'], ['Massa Lancelotti',150,'Napolitana, cebola, manjericão e gorgonzola'],
  ['Massa Frutos do Mar',240], ['Massa Daquele',170,'Napolitana, gorgonzola, Catupiry, mignon e azeitona'],
  ['Massa Napolitana',140], ['Massa Barbosa',200,'Napolitana, calabresa, gorgonzola, muçarela e Catupiry'], ['Massa ao Sugo',120],
]);

varios('Frangos', [
  ['Peito à Parmegiana',159,'Com tagliarini à carbonara'], ['Frango a Passarinho',100,'Alho, polenta frita, parmesão e ervas'],
  ['Frango à Fiorentina',125,'Brócolis ao alho e batatas coradas'], ['Frango Alla Boheme',159,'Creme de espinafre e Catupiry'],
  ['Peito Grelhado',99,'Creme de milho e arroz'], ['Strogonoff de Frango',140,'Arroz e batata palha'],
  ['Frango à Cubana',159,'Presunto, frutas, arroz e batata palha'], ['Frango Piero',120,'Cebola, presunto, ervilha, arroz e fritas'],
]);

[['Sopa de Legumes Como Eu Gosto',59,74],['Canja de Galinha',54,69],['Canja de Legumes',54,69],['Capeletti in Brodo',64,79],['Creme de Palmito',59,71],['Creme de Aspargo',59,71],['Sopa de Frutos do Mar',74,94],['Sopa de Peixe',74,94]]
  .forEach(([n,a,b]) => { add('Sopas',`${n} - Individual`,a); add('Sopas',`${n} - 2 pessoas`,b); });
varios('Acompanhamentos', [['Batatas Fritas',40],['Polenta Frita',40],['Panachê de Legumes',60],['Brócolis ao Alho e Óleo',40],['Creme de Milho',60],['Maionese de Batata',50],['Arroz Piemontese',45],['Arroz à Grega',35],['Arroz Branco',25],['Farofa Completa',35]]);

varios('Mignon', [
  ['Mignon Osvaldo Aranha',270],['Mignon à Parmegiana',320],['Mignon 4 Formaggi',280],['Mignon Alla Boheme',300],['Mignon Barbosa',350],
  ['Mignon à Cubana',250],['Mignon Basílico',270],['Mignon Alla Sicilia',300],['Mignon à Cavalo',220],['Mignon Grelhado',210],
  ['Mignon Veneziana',250],['Mignon Fiorentina',230],['Mignon ao Molho Mostarda',220],['Strogonoff de Mignon',169],
  ['Escalope à Moda do Chef',280],['Escalope à Daniel',300],['Escalope à Parmegiana',220],['Escalope à Piero',260],
  ['Escalope Completo',220],['Saltimboca Alla Romana',250],
]);

const estilosPeixe = [['Belle Méunière',[259,269,279]],['Fiorentina',[219,229,239]],['Brasileira',[269,279,289]],['Mangiare Felice',[279,289,299]],['Moda da Casa',[279,289,299]],['Ao Molho de Camarão',[259,269,279]],['Ao Frutos do Mar',[299,309,319]]];
estilosPeixe.forEach(([e,ps]) => ['Salmão','Linguado','Congrio'].forEach((p,i) => add('Peixes',`${p} ${e}`,ps[i])));
varios('Peixes', [['Linguado à Moda do Japonês',269],['Salmão ao Molho de Maracujá',289],['Moqueca de Congrio',299],['Bacalhau da Nonna',319],['Bacalhau ao Forno',319],['Bacalhau à Belle Méunière',319]]);
varios('Camarões', [['Camarão Piero',290],['Camarão à Grega',280],['Strogonoff de Camarão',280],['Camarão ao Catupiry',300],['Moqueca de Camarão',320],['Camarões Empanados e Fritos',230]]);
varios('Risotos', [['Risoto de Frango',150],['Risoto de Camarão',280],['Risoto de Frutos do Mar',300],['Risoto Filetto Etrusco',300],['Risoto de Funghi Italiano',259]]);
varios('Polpetones', [['Polpetone à Parmegiana',140],['Polpetone à 4 Formaggi',160]]);
varios('Carnes Especiais', [['Pernil de Vitela com Creme de Espinafre',170],['Pernil de Vitela à Fiorentina',160],['Pernil de Vitela à Moda do Chefe',200],['Pernil de Vitela ao Molho Mostarda',200],['Pernil de Cordeiro',300],['Paleta de Cordeiro',280],['Cordeiro Desossado',250],['Língua Bovina ao Molho Madeira',140]]);

varios('Bebidas', [['Água Mineral 330ml',8],['Água San Pellegrino 505ml',45],['Suco de Uva Integral 250ml',20],['Suco Natural - Copo',18],['Suco Natural - Jarra 500ml',30],['Jarra Especial 500ml',40],['Refrigerante KS',10],['Refrigerante Lata',12],['Refrigerante H2OH! 500ml',15],['Chá Gelado 450ml',15],['Mangiare Mule',20],['Piña Colada sem Álcool',25],['Mojito Virgin',22],['Pink Ginger',22],['Suco de Tomate',20],['Caipirinha de Limão sem Álcool',25],['Soda Italiana',20],['Café Expresso Pequeno',8],['Café Expresso Grande',10]]);
varios('Sobremesas', [['Banana Flambada',27],['Pudim de Leite',17],['Salada de Frutas',27],['Fatia de Fruta',15],['Creme de Papaia',37],['Creme de Morango',37],['Profiteróles',37],['Sorvete de Creme',17],['Petit Gâteau de Chocolate',38],['Petit Gâteau de Doce de Leite',38],['Tiramisù',31],['Mousse de Chocolate Della Nonna',18]]);

function fichaPara(prato, ids) {
  const t = `${prato.nome} ${prato.descricao}`.toLowerCase();
  const itens = [];
  const usar = (nome, quantidade, unidade) => { if (ids[nome]) itens.push({ insumo_id: ids[nome], quantidade, unidade }); };
  const cat = prato.categoria;
  if (cat === 'Bebidas') return [];
  if (cat === 'Massas') usar(t.includes('rechead') ? 'Massa recheada fresca' : 'Massa artesanal fresca', 600, 'G');
  else if (cat === 'Vegano') usar('Massa vegana de pupunha', 300, 'G');
  else if (cat === 'Mignon') usar('Filé mignon', 600, 'G');
  else if (cat === 'Frangos') usar('Peito de frango', 550, 'G');
  else if (cat === 'Camarões') usar('Camarão limpo', 500, 'G');
  else if (cat === 'Risotos') usar('Arroz arbóreo', 350, 'G');
  else if (cat === 'Polpetones') usar('Carne moída', 500, 'G');
  else if (cat === 'Carnes Especiais') usar(t.includes('cordeiro') ? 'Cordeiro' : t.includes('língua') ? 'Língua bovina' : 'Pernil de vitela', 600, 'G');
  else if (cat === 'Peixes') usar(t.includes('salmão') ? 'Salmão' : t.includes('linguado') ? 'Linguado' : t.includes('congrio') ? 'Congrio' : 'Bacalhau', 550, 'G');
  else if (cat === 'Saladas') usar('Folhas verdes', t.includes('4 pessoa') ? 500 : t.includes('2 pessoa') ? 300 : 180, 'G');
  else if (cat === 'Sopas') usar(t.includes('frutos') ? 'Mix frutos do mar' : t.includes('peixe') ? 'Linguado' : t.includes('frango') || t.includes('canja') ? 'Peito de frango' : 'Palmito', t.includes('2 pessoas') ? 350 : 220, 'G');
  else if (cat === 'Bambino') usar(t.includes('filé mignon') || t.includes('iscas de filé') ? 'Filé mignon' : t.includes('frango') ? 'Peito de frango' : 'Massa artesanal fresca', 180, 'G');
  else if (cat === 'Acompanhamentos') usar(t.includes('arroz') ? 'Arroz branco' : t.includes('brócolis') ? 'Brócolis' : t.includes('farofa') ? 'Farinha de rosca' : 'Batata', 450, 'G');
  else if (cat === 'Sobremesas') usar(t.includes('chocolate') || t.includes('gâteau') || t.includes('mousse') ? 'Chocolate' : t.includes('sorvete') ? 'Sorvete de creme' : t.includes('banana') ? 'Banana' : 'Frutas variadas', 180, t.includes('sorvete') ? 'ML' : 'G');
  else if (cat === 'Entradas') usar(t.includes('salmão') ? 'Salmão' : t.includes('lula') ? 'Lula' : t.includes('bacalhau') ? 'Bacalhau' : t.includes('siri') ? 'Siri' : t.includes('provolone') ? 'Provolone' : 'Pão italiano', 250, 'G');
  if (!itens.length) usar('Temperos e molhos', 100, 'G');
  if (/molho|sugo|napolit|parmegiana|bolognesa|strogonoff/.test(t)) usar('Molho de tomate', 300, 'G');
  if (/branco|creme|carbonara|strogonoff|panna/.test(t)) usar('Creme de leite', 250, 'ML');
  if (/camar|frutos do mar/.test(t) && cat !== 'Camarões') usar('Camarão limpo', 200, 'G');
  if (/mignon|escalope|filé/.test(t) && !['Mignon','Bambino'].includes(cat)) usar('Filé mignon', 250, 'G');
  if (/frango/.test(t) && cat !== 'Frangos') usar('Peito de frango', 250, 'G');
  if (/muçarela/.test(t)) usar(t.includes('búfala') ? 'Muçarela de búfala' : 'Muçarela', 150, 'G');
  if (/gorgonzola|4 formaggi|quatro queijos|4 queijos/.test(t)) usar('Gorgonzola', 100, 'G');
  if (/catupiry/.test(t)) usar('Catupiry', 120, 'G');
  if (/bacon/.test(t)) usar('Bacon', 100, 'G');
  if (/funghi/.test(t)) usar('Funghi seco', 35, 'G');
  if (/tomate seco/.test(t)) usar('Tomate seco', 80, 'G');
  if (/espinafre/.test(t)) usar('Espinafre', 180, 'G');
  if (/parmesão/.test(t)) usar('Parmesão', 70, 'G');
  if (/arroz/.test(t) && cat !== 'Risotos') usar('Arroz branco', 250, 'G');
  if (/batata|fritas|purê/.test(t) && cat !== 'Acompanhamentos') usar('Batata', 300, 'G');
  usar('Temperos e molhos', 30, 'G');
  return itens;
}

const tokenInfo = await requisicao('/auth/login', 'POST', { token: acesso });
const login = await requisicao('/funcionarios/login', 'POST', { estabelecimento_token: acesso, usuario, senha });
const sessao = login.token;
const existentes = await requisicao('/produtos', 'GET', undefined, sessao);
const produtosPorNome = new Map(existentes.map((p) => [p.nome.toLowerCase(), p]));
const categoriasAtuais = await requisicao('/categorias', 'GET', undefined, sessao);

const cores = ['#ef4444','#f59e0b','#22c55e','#0ea5e9','#8b5cf6','#ec4899','#14b8a6'];
const categorias = Object.fromEntries(categoriasAtuais.map((c) => [c.nome, c.id]));
async function garantirCategoria(nome, cor, pai = null) {
  if (categorias[nome]) return categorias[nome];
  const c = await requisicao('/categorias','POST',{ nome, cor, categoria_pai_id:pai },sessao);
  categorias[nome] = c.id;
  return c.id;
}
for (const [i, nome] of ['Cardápio','Insumos','Bebidas'].entries()) {
  await garantirCategoria(nome, cores[i]);
}
for (const [i, nome] of [...new Set(pratos.map((p) => p.categoria))].entries()) {
  if (categorias[nome]) continue;
  const pai = nome === 'Bebidas' ? categorias.Bebidas : categorias.Cardápio;
  await garantirCategoria(nome, cores[(i+2)%cores.length], pai);
}
for (const [i, nome] of [...new Set(insumos.map((x) => x[3]))].entries()) {
  const nomeCategoria = `Insumos - ${nome}`;
  categorias[`I:${nome}`] = await garantirCategoria(nomeCategoria, cores[(i+3)%cores.length], categorias.Insumos);
}

const ids = {};
for (const [nome, unidade, custo, grupo] of insumos) {
  const existente = produtosPorNome.get(nome.toLowerCase());
  if (existente) { ids[nome] = existente.id; continue; }
  const p = await requisicao('/produtos','POST',{ nome, unidade, custo, tipo:'insumo', estoque_atual:0, estoque_minimo:0, categoria_ids:[categorias[`I:${grupo}`]], exibir_restaurante:false, exibir_mercado:false, observacoes:'Custo estimado em pesquisa de mercado de Curitiba/PR em agosto de 2026; substituir pelo custo real da nota fiscal.' },sessao);
  ids[nome]=p.id;
  produtosPorNome.set(nome.toLowerCase(), p);
}

let criados = 0;
for (const prato of pratos) {
  if (produtosPorNome.has(prato.nome.toLowerCase())) continue;
  const ficha = fichaPara(prato, ids);
  await requisicao('/produtos','POST',{ nome:prato.nome, unidade:'UN', tipo:ficha.length?'composto':'produto', preco:prato.preco, custo:ficha.length?0:Number((prato.preco*0.35).toFixed(2)), ingredientes:ficha, categoria_ids:[categorias[prato.categoria]], exibir_restaurante:true, exibir_mercado:false, observacoes:`${prato.descricao || 'Conforme cardápio.'} Preço de venda extraído do Cardapio.pdf; ficha técnica inicial estimada e sujeita à conferência de rendimento.` },sessao);
  criados++;
  produtosPorNome.set(prato.nome.toLowerCase(), { nome: prato.nome });
  if (criados % 20 === 0) console.log(`${criados}/${pratos.length} pratos cadastrados`);
}
console.log(JSON.stringify({ estabelecimento:tokenInfo.nome, insumos:insumos.length, pratos:criados, total:insumos.length+criados }));
