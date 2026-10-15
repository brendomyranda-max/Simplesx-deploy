(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const android = window.DoixPAndroid;
  const isAndroid = () => Boolean(android?.available());
  const driverMode = location.pathname === '/driver';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const money = cents => (Number(cents || 0) / 100).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
  const date = value => value ? new Date(value).toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
  const number = value => Number(value || 0).toLocaleString('pt-BR', {maximumFractionDigits:2});
  const icons = {
    grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    package:'<path d="m3 7 9-5 9 5v10l-9 5-9-5V7Zm0 0 9 5 9-5M12 12v10M7.5 4.5l9 5V14"/>',
    bike:'<circle cx="5" cy="17" r="4"/><circle cx="19" cy="17" r="4"/><path d="m5 17 5-9 5 9h4l-5-12h3M8 8h5"/>',
    wallet:'<path d="M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v11H5a3 3 0 0 1-3-3V6m18 6h-5v5h5m-4-2.5h.01"/>',
    shield:'<path d="M12 3 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-3Z"/><path d="m8 12 3 3 5-6"/>',
    users:'<circle cx="9" cy="7" r="4"/><path d="M1 21v-3a8 8 0 0 1 16 0v3M17 3a4 4 0 0 1 0 8m2 3a7 7 0 0 1 4 7"/>',
    settings:'<path d="M4 7h16M4 17h16M8 4v6m8 4v6"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
    pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    store:'<path d="M3 10V6l2-3h14l2 3v4a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0Zm2 3v8h14v-8M9 21v-6h6v6"/>',
    check:'<path d="m5 12 4 4L20 5"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
    logout:'<path d="M9 4H4v16h5m5-13 5 5-5 5m-6-5h11"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    phone:'<path d="m8 3 3 5-3 3a13 13 0 0 0 5 5l3-3 5 3-1 5C10 22 2 14 3 4l5-1Z"/>',
    copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    map:'<path d="m2 5 6-3 8 3 6-3v17l-6 3-8-3-6 3V5Zm6-3v17m8-14v17"/>',
    locate:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>',
    alert:'<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3h.01"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.package}</svg>`;
  const brand = () => '<div class="brand"><span class="brand-mark">D<span>↗</span></span><span class="brand-title">DoixP<small>Entregas</small></span></div>';
  const roles = {support:'Suporte e operação',merchant:'Estabelecimento',driver:'Entregador'};
  const statuses = {awaiting_customer:'Aguardando cliente',searching:'Buscando entregador',accepted:'Entregador a caminho',in_transit:'Em entrega',incident:'Em análise',delivered:'Entregue',cancelled:'Cancelado',returned:'Devolvido'};
  const eventNames = {created:'Pedido criado',customer_accepted:'Frete aceito pelo cliente',customer_declined:'Frete recusado pelo cliente',ready:'Pedido pronto para retirada',accepted:'Corrida aceita',picked_up:'Retirada confirmada',pickup:'Retirada confirmada',delivered:'Entrega concluída',contact_customer:'Contato com o cliente registrado',contact_merchant:'Contato com a loja registrado',incident:'Ocorrência aberta',incident_opened:'Ocorrência aberta',incident_resolved:'Análise concluída',compensation_defined:'Compensação definida',pickup_code_failed:'Código de retirada inválido',delivery_code_failed:'Código de entrega inválido',reported:'Ocorrência aberta',resolved:'Análise concluída',cancelled:'Pedido cancelado',resumed:'Entrega retomada',returned:'Devolução confirmada',settlement_closed:'Fechamento semanal registrado'};
  const badge = status => `<span class="badge ${esc(status)}">${esc(statuses[status] || ({pending:'A pagar',paid:'Pago',open:'Em análise',resolved:'Resolvida'}[status]) || status)}</span>`;
  const state = {user:null, data:null, view:'overview', filter:'active', accounts:[], rendered:'', map:null, markerLayer:null, watch:null, heartbeat:null, location:null, polling:false, customerToken:new URLSearchParams(location.search).get('cliente'), offline:false};
  state.nativeTracking = false;
  state.deletionRequests = [];
  let toastTimer;
  function toast(message) {const el = $('#toast');el.textContent = message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer = setTimeout(() => el.classList.remove('visible'), 4500);}
  async function api(path, {method='GET',body} = {}) {
    const response = await fetch(path, {method,credentials:'same-origin',headers:{...(body !== undefined ? {'Content-Type':'application/json'} : {})},...(body !== undefined ? {body:JSON.stringify(body)} : {})});
    let result;try {result = await response.json();} catch {throw new Error('O servidor não respondeu como esperado. Tente novamente.');}
    if (!response.ok) {const error = new Error(typeof result.error === 'string' ? result.error : result.error?.message || result.message || 'Não foi possível concluir esta ação.');error.status = response.status;throw error;}
    return result;
  }
  function setDialog(title, content) {
    const dialog = $('#dialog');
    dialog.innerHTML = `<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="icon-button" data-action="close-dialog" type="button" aria-label="Fechar janela">${icon('close')}</button></div><div class="dialog-body">${content}</div>`;
    if (!dialog.open) dialog.showModal();
  }
  function closeDialog() {$('#dialog').close();renderPageIfChanged();}
  const formError = '<div class="form-error" role="alert"></div>';
  const formActions = (label='Salvar') => `<div class="form-actions"><button class="btn" data-action="close-dialog" type="button">Voltar</button><button class="btn primary" type="submit">${esc(label)}${icon('arrow')}</button></div>`;
  function field(label,name,{type='text',placeholder='',required=true,value='',hint='',attrs='',span=false}={}) {
    return `<label class="field${span ? ' span-2' : ''}">${esc(label)}<input name="${esc(name)}" type="${esc(type)}" ${required ? 'required' : ''} value="${esc(value)}" placeholder="${esc(placeholder)}" ${attrs}>${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
  }
  const empty = (title,description,button='',symbol='package') => `<div class="empty"><div class="empty-icon">${icon(symbol)}</div><h3>${esc(title)}</h3><p>${esc(description)}</p>${button}</div>`;
  const button = (label,action,{id='',primary=false,symbol='',className=''}={}) => `<button class="btn ${primary?'primary ':''}${esc(className)}" data-action="${esc(action)}" ${id ? `data-id="${esc(id)}"` : ''}>${symbol ? icon(symbol) : ''}${esc(label)}</button>`;
  const activeOrder = order => !['delivered','cancelled','returned'].includes(order.status);
  const ownDriver = () => state.data?.drivers.find(driver => driver.id === state.user.id);
  const driverOnline = () => Boolean(ownDriver()?.online && (!isAndroid() || state.nativeTracking));
  const customerLink = order => order.customerToken ? `${location.origin}/?cliente=${encodeURIComponent(order.customerToken)}` : '';
  const phoneLink = phone => phone ? `<a href="tel:${esc(String(phone).replace(/[^0-9+]/g,''))}">${esc(phone)}</a>` : 'Não informado';
  function authView(setup=false) {
    stopLocation();destroyMap();state.user=null;state.nativeTracking=false;
    if(isAndroid())android.request('stopTracking').catch(()=>{});
    if($('#dialog').open)$('#dialog').close();
    if(driverMode) return driverAuthView();
    $('#app').innerHTML = `<main class="auth"><section class="auth-story">${brand()}<div class="auth-copy"><span class="eyebrow">Da sua loja até a porta.</span><h1>Boas entregas.<br><span>Novas conexões.</span></h1><p>Sua operação de entregas em um só lugar. Mais clareza para a loja, o entregador e quem está esperando.</p><div class="auth-steps"><div class="auth-step"><span>01</span>A loja prepara. O entregador aceita.</div><div class="auth-step"><span>02</span>Códigos confirmam cada etapa.</div><div class="auth-step"><span>03</span>Valores organizados toda semana.</div></div></div><div class="auth-bottom">DoixP Entregas · Feito para aproximar.</div></section><section class="auth-form-wrap"><div class="auth-form"><span class="eyebrow">${setup ? 'Vamos começar' : 'Sua operação, conectada'}</span><h2>${setup ? 'Crie o primeiro acesso' : 'Bom ter você por aqui.'}</h2><p>${setup ? 'Configure a conta de suporte. Depois, cadastre os estabelecimentos e entregadores da sua operação.' : 'Entre na sua conta para acompanhar os pedidos e fazer a próxima entrega acontecer.'}</p><form data-form="${setup ? 'setup' : 'login'}">${setup ? field('Seu nome','name',{placeholder:'Como podemos chamar você?',attrs:'autocomplete="name" maxlength="100"'}) : ''}${field('Usuário','username',{placeholder:'seu.usuario',attrs:'autocomplete="username" autocapitalize="none" spellcheck="false" minlength="3" maxlength="80"'})}${field('Senha','password',{type:'password',placeholder:setup ? 'Pelo menos 10 caracteres' : 'Sua senha',attrs:`autocomplete="${setup ? 'new-password' : 'current-password'}" ${setup ? 'minlength="10"' : ''} maxlength="128"`})}${formError}<button class="btn primary full" type="submit">${setup ? 'Criar acesso de suporte' : 'Entrar na plataforma'}${icon('arrow')}</button></form><div class="auth-footer">${icon('shield')}${setup ? 'Você será responsável pelos acessos e pelas análises da operação.' : 'Seu acesso é fornecido pelo suporte da plataforma.'}</div></div></section></main>`;
  }
  function driverAuthView(register=false) {
    const fields=register ? `${field('Seu nome','name',{attrs:'autocomplete="name" maxlength="100"',span:true})}${field('Telefone com DDD','phone',{type:'tel',attrs:'inputmode="tel" maxlength="40"',span:true})}` : '';
    $('#app').innerHTML=`<main class="auth"><section class="auth-story">${brand()}<div class="auth-copy"><span class="eyebrow">APP DO ENTREGADOR</span><h1>Pronto para a próxima corrida?</h1><p>Fique online, aceite pedidos próximos, confira a retirada na loja e confirme a entrega com o cliente.</p></div></section><section class="auth-form-wrap"><div class="auth-form"><span class="eyebrow">DOIXP ENTREGADOR</span><h2>${register?'Crie sua conta':'Entre na sua conta'}</h2><p>${register?'Seu cadastro passará pela análise do suporte antes de receber corridas.':'Faça login para ver suas entregas e ficar online.'}</p><form data-form="${register?'driver-register':'login'}">${fields}${field('Usuário','username',{attrs:'autocomplete="username" minlength="3" maxlength="80" autocapitalize="none"'})}${field('Senha','password',{type:'password',attrs:`autocomplete="${register?'new-password':'current-password'}" minlength="10" maxlength="128"`})}${formError}<button class="btn primary full" type="submit">${register?'Solicitar cadastro':'Entrar'}${icon('arrow')}</button></form><button class="text-button" type="button" data-action="${register?'driver-login':'driver-signup'}">${register?'Já tenho uma conta':'Quero me cadastrar como entregador'}</button></div></section></main>`;
  }
  function navItems() {
    const items = [['overview','grid','Visão geral'],['orders','package',state.user.role==='driver' ? 'Corridas' : 'Entregas']];
    if (state.user.role === 'support') items.push(['accounts','users','Equipe e lojas']);
    items.push(['incidents','shield','Ocorrências'],['finance','wallet','Financeiro']);
    if (state.user.role === 'support') items.push(['privacy','shield','Solicitações de exclusão'],['settings','settings','Configurações']);
    items.push(['account','users','Minha conta']);
    return items;
  }
  function renderShell() {
    destroyMap();
    const user = state.user;
    const initials = user.name.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
    $('#app').innerHTML = `<div class="shell"><aside class="sidebar">${brand()}<div class="nav-label">ESPAÇO DE TRABALHO</div><nav class="navigation" aria-label="Menu principal">${navItems().map(([key,symbol,label])=>`<button class="nav-link ${state.view===key?'active':''}" data-view="${key}" ${state.view===key ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span></button>`).join('')}</nav><div class="sidebar-note"><p><a href="/privacy.html">Privacidade</a> · <a href="/account-deletion.html">Solicitar exclusão da conta</a></p><strong>${icon('shield')} Cada etapa, confirmada.</strong>Retirada com código de 6 dígitos.<br>Entrega com confirmação do cliente.</div><div class="profile"><div class="avatar">${esc(initials)}</div><div class="profile-info"><strong>${esc(user.name)}</strong><span>${roles[user.role]}</span></div><button class="icon-button" data-action="logout" aria-label="Sair da conta">${icon('logout')}</button></div></aside><main class="main"><header class="topbar"><div class="breadcrumb">DoixP Entregas <span>/</span> <strong id="breadcrumb-view"></strong></div><div class="topbar-right"><span class="topbar-date">${esc(new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'}))}</span><span class="live-label" id="connection-status"><span class="dot"></span>Conectado</span><button class="icon-button" data-action="logout" title="Sair da conta" aria-label="Sair da conta">${icon('logout')}</button></div></header><div class="page" id="page"></div></main></div>`;
    state.rendered='';renderPage();
  }
  function heading(title,subtitle,actions='') {return `<div class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div>${actions ? `<div class="heading-buttons">${actions}</div>`:''}</div>`;}
  function pageButton() {return state.user.role==='merchant' ? button('Nova entrega','new-order',{primary:true,symbol:'plus'}) : state.user.role==='support' ? button('Novo cadastro','new-account',{primary:true,symbol:'plus'}) : ownDriver()?.approved ? button(driverOnline() ? 'Ficar offline':'Ficar online','availability',{primary:true,symbol:'bike'}) : '';}
  function driverBanner() {
    if(state.user.role!=='driver') return '';
    const driver=ownDriver();
    if(driver && !driver.approved) return `<div class="banner warning"><div><strong>Cadastro aguardando análise</strong><p>O suporte precisa aprovar sua conta antes que você possa ficar online e aceitar corridas.</p></div>${icon('shield')}</div>`;
    if(driver?.suspended) return `<div class="banner warning"><div><strong>Seu acesso às corridas está em análise</strong><p>O suporte está analisando uma ocorrência. Acompanhe os registros no menu Ocorrências.</p></div>${icon('shield')}</div>`;
    return `<div class="banner"><div><strong>${driverOnline() ? 'Você está online. Vamos fazer a próxima entrega?' : 'Tudo pronto para sair?'}</strong><p>${driverOnline() ? (isAndroid() ? 'O Android acompanha sua localização enquanto você estiver online, com uma notificação no celular.' : 'Sua localização é compartilhada enquanto você estiver online.') : 'Fique online e permita sua localização para receber as corridas disponíveis.'}</p></div>${button(driverOnline()?'Ficar offline':'Ficar online','availability',{primary:!driverOnline(),symbol:'bike'})}</div>`;
  }
  function statsMarkup() {
    const orders=state.data.orders;
    const today=new Date().toLocaleDateString('pt-BR');
    const delivered=orders.filter(order=>order.status==='delivered' && new Date(order.deliveredAt || order.updatedAt).toLocaleDateString('pt-BR')===today);
    const active=orders.filter(order=>activeOrder(order)&&(state.user.role!=='driver'||order.driverId===state.user.id));
    const driverRole=state.user.role==='driver';
    const receipts=driverRole ? state.data.settlements.filter(item=>item.status==='pending').reduce((total,item)=>total+item.cents,0) : delivered.reduce((total,order)=>total+order.totalCents,0);
    const cards=[['Entregas em andamento',active.length,'Pedidos acompanhados agora','package'],['Entregas concluídas',delivered.length,'Concluídas hoje','check'],[driverRole?'Corridas disponíveis':'Entregadores online',driverRole?orders.filter(order=>order.status==='searching').length:state.data.drivers.filter(driver=>driver.online&&!driver.suspended).length,driverRole?'Aguardando aceite':'Disponíveis na operação','bike'],[driverRole?'Fechamentos a receber':'Fretes concluídos hoje',money(receipts),driverRole?'Repasse registrado pelo suporte':'Valor total das entregas','wallet']];
    return `<div class="stats">${cards.map(([label,value,note,symbol],index)=>`<article class="stat ${index===3?'featured':''}"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon(symbol)}</span></div><strong>${esc(value)}</strong><small>${note}</small></article>`).join('')}</div>`;
  }
  function deliveryRow(order) {return `<div class="delivery-row" role="button" tabindex="0" data-action="order" data-id="${esc(order.id)}"><div class="row-head"><strong>#${esc(order.reference || order.id.slice(0,8))}</strong>${badge(order.status)}</div><div class="row-detail"><div class="row-route">${icon('store')}<span>${esc(order.merchantName || 'Seu estabelecimento')}</span><span>· ${number(order.distanceKm)} km</span></div><strong>${money(order.totalCents)}</strong></div></div>`;}
  function overviewPage() {
    const orders=state.data.orders.filter(activeOrder).slice(0,4);
    const settings=state.data.settings;
    return `${heading('Cada entrega conta.','Acompanhe sua operação e mantenha tudo em movimento.',pageButton())}${driverBanner()}${statsMarkup()}<div class="overview-grid"><section class="card"><div class="card-header"><div><h2>Operação no mapa</h2><p>Uma visão de quem está por perto.</p></div><button class="text-button" data-action="locate">${icon('locate')}Minha localização</button></div><div class="map-panel"><div class="map-placeholder">${icon('map')}<p>Carregando mapa…</p></div><div class="map" id="map"></div><div class="map-status" id="map-status">Localizações informadas pelos participantes. Destinos aproximados antes da retirada.</div></div><div class="map-legend"><div class="legend-items"><span class="legend-item"><i class="legend-square"></i>Estabelecimentos</span><span class="legend-item"><i class="legend-square gold"></i>Entregadores</span></div><span>OpenStreetMap</span></div></section><div class="stack"><section class="card"><div class="card-header"><div><h2>Em andamento</h2><p>O próximo passo de cada pedido.</p></div><button class="text-button" data-view="orders">Ver todas ${icon('arrow')}</button></div>${orders.length ? orders.map(deliveryRow).join('') : empty('Sua próxima entrega começa aqui',state.user.role==='merchant' ? 'Cadastre um pedido para conectar sua loja a um entregador.' : state.user.role==='driver' ? 'As corridas aparecem aqui quando você estiver online e houver pedidos disponíveis.' : 'Cadastre lojas e entregadores para começar a movimentar sua operação.','', 'bike')}</section><section class="card tariff-card"><span class="eyebrow">Uma tarifa clara, desde o início</span><div class="tariff-price">${money(settings.baseCents)}<small>até ${number(settings.baseKm)} km</small></div><p>O estabelecimento escolhe quanto participa. O cliente aprova sua parte antes de chamar o entregador.</p><div class="tariff-detail">${icon('arrow')}Após ${number(settings.baseKm)} km: ${money(settings.extraKmCents)} por km adicional</div></section></div></div><section class="card section-margin"><div class="card-header"><h2>Um caminho simples. Cada etapa protegida.</h2><span class="badge">Como funciona</span></div><div class="flow">${[['Pedido criado','A loja define o percurso e a divisão do frete.'],['Corrida aceita','Um entregador online assume a entrega.'],['Retirada confirmada','A loja valida o código de 6 dígitos.'],['Entrega concluída','O cliente informa o código de confirmação.']].map(([title,description],index)=>`<div class="flow-step"><span class="flow-number">0${index+1}</span><div><h3>${title}</h3><p>${description}</p></div></div>`).join('')}</div></section><footer class="page-footer"><span>${icon('shield')} DoixP Entregas · Conexões que chegam mais longe.</span><span>Valores em reais · Horários do seu navegador</span></footer>`;
  }
  function ordersPage() {
    let orders=state.data.orders;
    if(state.filter==='active') orders=orders.filter(activeOrder);
    if(state.filter==='history') orders=orders.filter(order=>!activeOrder(order));
    if(state.filter==='available') orders=orders.filter(order=>order.status==='searching');
    return `${heading(state.user.role==='driver'?'Suas corridas':'Suas entregas','Da preparação até a confirmação na porta do cliente.',state.user.role==='merchant'?pageButton():'')}${driverBanner()}<div class="filter-bar">${[['active','Em andamento'],...(state.user.role==='driver'?[['available','Disponíveis']]:[]),['history','Histórico'],['all','Todas']].map(([key,label])=>`<button class="btn compact ${state.filter===key?'active':''}" data-filter="${key}">${label}</button>`).join('')}</div>${orders.length ? `<div class="orders-grid">${orders.map(order=>`<article class="card order-card"><div class="row-head"><strong>#${esc(order.reference||order.id.slice(0,8))}</strong>${badge(order.status)}</div><div class="route"><div class="route-line">${icon('store')}<div><strong>${esc(order.merchantName||'Estabelecimento')}</strong><p>${esc(order.merchantAddress||'Endereço da retirada')}</p></div></div><div class="route-line">${icon('pin')}<div><strong>${esc(order.customerName||'Destino protegido até a retirada')}</strong><p>${esc(order.destinationAddress||'Localização aproximada disponível no mapa')} · ${number(order.distanceKm)} km</p></div></div></div><div class="order-bottom"><div><strong>${money(order.totalCents)}</strong><small>${order.ready?'Pronto para retirada':'Em preparação'}</small></div>${button('Ver entrega','order',{id:order.id,symbol:'arrow',className:'compact'})}</div></article>`).join('')}</div>` : `<section class="card">${empty('Nenhuma entrega por aqui',state.user.role==='driver'?'Fique online para receber ofertas. Você também pode conferir suas entregas no histórico.':'Os pedidos aparecerão nesta lista conforme sua operação acontecer.',state.user.role==='merchant'?button('Criar primeira entrega','new-order',{primary:true,symbol:'plus'}):'')}</section>`}`;
  }
  function incidentsPage() {
    const incidents=state.data.incidents;
    return `${heading('Cuidado em cada etapa.','Acompanhe contatos, imprevistos e análises da operação.')}<div class="banner"><div><strong>Não conseguiu encontrar o cliente?</strong><p>Registre a tentativa de contato com o cliente, avise o estabelecimento e abra uma ocorrência na entrega.</p></div>${icon('shield')}</div><section class="card"><div class="card-header"><h2>Ocorrências registradas</h2><span class="badge">${incidents.filter(item=>item.status==='open').length} em análise</span></div>${incidents.length?incidents.map(incident=>`<article class="incident-row"><div class="row-head"><strong>${esc({unreachable:'Cliente não localizado',fraud:'Suspeita de irregularidade',other:'Ocorrência na entrega',code_attempts:'Limite de códigos inválidos',cancellation:'Solicitação de cancelamento'}[incident.kind]||'Ocorrência na entrega')}</strong>${badge(incident.status)}</div><p>${esc(incident.note)}</p><div class="row-detail"><span>Pedido #${esc(state.data.orders.find(order=>order.id===incident.orderId)?.reference||incident.orderId.slice(0,8))} · ${date(incident.createdAt)}</span>${button(incident.status==='open'&&state.user.role==='support'?'Analisar':'Ver entrega',incident.status==='open'&&state.user.role==='support'?'resolve':'order',{id:incident.orderId,className:'compact'})}</div>${incident.resolution?`<p class="small muted">Resultado: ${esc({resume:'Entrega retomada',returned:'Devolução confirmada',cancelled:'Cancelamento confirmado'}[incident.resolution]||incident.resolution)}</p>`:''}</article>`).join(''):empty('Nenhuma ocorrência registrada','As solicitações de ajuda e análises de entrega aparecerão aqui.','', 'shield')}</section>`;
  }
  function financePage() {
    const support=state.user.role==='support';
    if(state.user.role==='merchant') {
      const orders=state.data.orders.filter(order=>order.status==='delivered');
      return `${heading('Entregas com os valores em dia.','Veja sua participação nos fretes concluídos.')}<section class="card"><div class="settlement-total"><div><span class="eyebrow">Participação do estabelecimento</span><p>${orders.length} entregas concluídas</p></div><strong>${money(orders.reduce((total,order)=>total+order.merchantCents,0))}</strong></div>${orders.length?`<div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Frete total</th><th>Loja</th><th>Cliente</th></tr></thead><tbody>${orders.map(order=>`<tr><td><strong>#${esc(order.reference)}</strong><small>${date(order.deliveredAt||order.updatedAt)}</small></td><td>${money(order.totalCents)}</td><td>${money(order.merchantCents)}</td><td>${money(order.customerCents)}</td></tr>`).join('')}</tbody></table></div>`:empty('Os valores acompanham suas entregas','Assim que uma entrega for concluída, a divisão do frete aparecerá aqui.','','wallet')}</section><p class="inline-note">Estes valores são registros da operação. A aprovação do frete pelo cliente não confirma recebimento do pagamento.</p>`;
    }
    const settlements=state.data.settlements;
    return `${heading('Toda semana, tudo certo.','Organize os valores dos entregadores e acompanhe os repasses.',support?button('Fechar semana','close-week',{primary:true,symbol:'wallet'}):'')}<section class="card"><div class="settlement-total"><div><span class="eyebrow">Fechamentos pendentes</span><p>${settlements.filter(item=>item.status==='pending').length} registros aguardando pagamento</p></div><strong>${money(settlements.filter(item=>item.status==='pending').reduce((total,item)=>total+item.cents,0))}</strong></div>${settlements.length?`<div class="table-wrap"><table><thead><tr>${support?'<th>Entregador</th>':''}<th>Semana iniciada em</th><th>Entregas</th><th>Valor</th><th>Situação</th><th>Registro</th></tr></thead><tbody>${settlements.map(item=>`<tr>${support?`<td><strong>${esc(item.driverName)}</strong></td>`:''}<td>${esc(item.weekStart.split('-').reverse().join('/'))}</td><td>${item.count}</td><td><strong>${money(item.cents)}</strong></td><td>${item.held?'<span class="badge incident">Retido para análise</span>':badge(item.status)}</td><td>${support&&item.status==='pending'&&!item.held?button('Registrar pagamento','paid',{id:item.id,className:'compact'}):`<span class="small">${esc(item.held?'Ocorrência pendente':item.reference||'Aguardando suporte')}</span>`}</td></tr>`).join('')}</tbody></table></div>`:empty('O próximo fechamento começa nas entregas','Entregas concluídas e compensações aprovadas são reunidas por semana, de segunda a domingo.','','wallet')}</section><p class="inline-note">O fechamento registra os valores devidos aos entregadores. O repasse é realizado fora da plataforma; o suporte registra a referência do pagamento após a transferência.</p>`;
  }
  function accountsPage() {
    return `${heading('Gente que faz acontecer.','Gerencie os estabelecimentos e entregadores da sua operação.',pageButton())}<section class="card"><div class="card-header"><h2>Contas da operação</h2><span class="badge">${state.accounts.length} cadastros</span></div>${state.accounts.length?`<div class="table-wrap"><table><thead><tr><th>Nome</th><th>Perfil</th><th>Contato</th><th>Situação</th><th>Ações</th></tr></thead><tbody>${state.accounts.map(account=>{const driver=state.data.drivers.find(item=>item.id===account.id);return `<tr><td><strong>${esc(account.name)}</strong><small>${esc(account.username||'')}</small></td><td><span class="account-role">${esc(roles[account.role]||account.role)}</span></td><td>${esc(account.phone||'—')}</td><td>${driver?.suspended?'<span class="badge incident">Suspenso</span>':driver&&!driver.approved?'<span class="badge incident">Aguardando análise</span>':driver?`<span class="live-label"><span class="dot ${driver.online?'':'gray'}"></span>${driver.online?'Online':'Offline'}</span>`:'<span class="badge">Ativo</span>'}</td><td>${account.role==='driver'?button(!driver?.approved&&!driver?.suspended?'Aprovar cadastro':driver?.suspended?'Liberar acesso':'Suspender','review-driver',{id:account.id,className:'compact'}):'—'}</td></tr>`;}).join('')}</tbody></table></div>`:empty('Comece pelas pessoas','Cadastre uma loja e um entregador para realizar suas primeiras entregas.',button('Novo cadastro','new-account',{primary:true,symbol:'plus'}),'users')}</section>`;
  }
  function settingsPage() {return `${heading('As regras da sua operação.','Frete claro para quem vende, entrega e recebe.')}<div class="settings-grid"><section class="card"><div class="card-header"><h2>Tarifa de entrega</h2>${icon('settings')}</div><div class="card-body"><div class="quote"><div class="quote-row"><span>Valor mínimo do frete</span><strong>${money(state.data.settings.baseCents)}</strong></div><div class="quote-row"><span>Distância incluída</span><strong>Até ${number(state.data.settings.baseKm)} km</strong></div></div><div class="divider"></div><form data-form="settings">${field('Valor por quilômetro adicional (R$)','extraKm',{type:'number',value:state.data.settings.extraKmCents/100,attrs:'min="0" max="1000" step="0.01"',hint:'Adicional inicial de R$ 2,00 por km, configurável para novos pedidos.'})}${formError}<div class="form-actions"><button class="btn primary" type="submit">Salvar tarifa${icon('check')}</button></div></form></div></section><section class="card"><div class="card-header"><h2>Divisão do frete</h2></div><div class="card-body"><div class="detail-item">Estabelecimento paga tudo<strong>A loja assume o frete completo, inclusive o excedente.</strong></div><div class="divider"></div><div class="detail-item">Estabelecimento paga a base<strong>A loja paga ${money(state.data.settings.baseCents)}. O cliente paga os quilômetros excedentes.</strong></div><div class="divider"></div><div class="detail-item">Base dividida meio a meio<strong>A loja paga ${money(state.data.settings.baseCents/2)}. O cliente paga a outra metade e o excedente.</strong></div><p class="inline-note">Quando houver participação do cliente, ele precisa aprovar o valor antes de disponibilizar o pedido aos entregadores.</p></div></section></div>`;}
  function accountPage() {
    return `${heading('Sua conta','Acesso, privacidade e seus dados na plataforma.')}<section class="card card-body"><h2>${esc(state.user.name)}</h2><p class="inline-note">${esc(roles[state.user.role])} · ${esc(state.user.username)}</p><div class="detail-actions"><a class="btn" href="/privacy.html">Política de privacidade</a><a class="btn" href="/account-deletion.html">Solicitar exclusão da conta</a>${button('Sair da conta','logout',{symbol:'logout'})}</div></section>`;
  }
  function privacyPage() {
    return `${heading('Solicitações de exclusão','Acompanhe os pedidos de exclusão de conta recebidos pelo site e pelo aplicativo.')}<section class="card">${state.deletionRequests.length ? state.deletionRequests.map(request => `<article class="incident-row"><div class="row-head"><strong>${esc(request.name)} · ${esc(roles[request.role])}</strong><span class="badge">Aguardando atendimento</span></div><p>${esc(request.note || 'Sem observações adicionais.')}</p><small>${esc(request.username)} · ${date(request.createdAt)} · Protocolo ${esc(request.id)}</small></article>`).join('') : empty('Nenhuma solicitação recebida','As solicitações de exclusão de conta aparecerão aqui.','','shield')}</section><p class="inline-note">O registro não exclui automaticamente os dados. O responsável pela operação deve atender o titular, verificar entregas e valores pendentes e executar a exclusão ou justificar a retenção aplicável.</p>`;
  }
  function destroyMap() {if(state.map){state.map.remove();state.map=null;state.markerLayer=null;}}
  function renderPage() {
    if(!state.user||!state.data||!$('#page')) return;
    destroyMap();
    const pages={overview:overviewPage,orders:ordersPage,incidents:incidentsPage,finance:financePage,accounts:accountsPage,settings:settingsPage,privacy:privacyPage,account:accountPage};
    $('#page').innerHTML=(pages[state.view]||overviewPage)();
    $('#breadcrumb-view').textContent=navItems().find(item=>item[0]===state.view)?.[2]||'Visão geral';
    document.querySelectorAll('.nav-link').forEach(element=>{element.classList.toggle('active',element.dataset.view===state.view);if(element.dataset.view===state.view)element.setAttribute('aria-current','page');else element.removeAttribute('aria-current');});
    state.rendered=JSON.stringify([state.data,state.accounts,state.deletionRequests,state.nativeTracking,state.view,state.filter]);
    if(state.view==='overview') initMap();
  }
  function renderPageIfChanged() {
    if($('#dialog').open||document.activeElement?.matches('input,select,textarea')||$('#page form[data-dirty="true"]')||state.rendered===JSON.stringify([state.data,state.accounts,state.deletionRequests,state.nativeTracking,state.view,state.filter])) return;
    renderPage();
  }
  function validCoordinates(lat,lng) {return lat!==null&&lat!==undefined&&lng!==null&&lng!==undefined&&Number.isFinite(Number(lat))&&Number.isFinite(Number(lng));}
  function initMap() {
    if(!$('#map')) return;
    if(!window.L){$('.map-placeholder p').textContent='O mapa precisa de conexão com a internet. Seus pedidos continuam disponíveis.';$('#map-status').textContent='Não foi possível carregar o mapa. Confira os endereços nos detalhes de cada entrega.';return;}
    const L=window.L;
    state.map=L.map('map',{scrollWheelZoom:false}).setView([-23.5505,-46.6333],12);
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(state.map);
    tiles.on('tileerror',()=>{const el=$('#map-status');if(el)el.textContent='Mapa temporariamente indisponível. Confira os endereços nos pedidos.';});
    state.markerLayer=L.layerGroup().addTo(state.map);
    const points=[],seen=new Set();
    function add(lat,lng,label,type,key) {
      if(!validCoordinates(lat,lng)||seen.has(key)) return;
      seen.add(key);points.push([Number(lat),Number(lng)]);
      L.marker([Number(lat),Number(lng)],{icon:L.divIcon({className:'',html:`<span class="map-pin ${type}">${type==='driver'?'↗':type==='customer'?'•':'D'}</span>`,iconSize:[30,30],iconAnchor:[15,15]})}).bindPopup(esc(label)).addTo(state.markerLayer);
    }
    state.data.orders.filter(activeOrder).forEach(order=>{add(order.merchantLat,order.merchantLng,order.merchantName,'merchant',`merchant-${order.merchantId || `${order.merchantLat},${order.merchantLng}`}`);if(validCoordinates(order.destinationLat,order.destinationLng))add(order.destinationLat,order.destinationLng,order.destinationAddress,'customer',`order-${order.id}`);else if(order.destinationApprox)add(order.destinationApprox.lat,order.destinationApprox.lng,'Região aproximada da entrega','customer',`order-${order.id}`);});
    state.data.drivers.filter(driver=>driver.online&&!driver.suspended).forEach(driver=>add(driver.lat,driver.lng,driver.name,'driver',`driver-${driver.id}`));
    if(state.user.role==='support')state.accounts.filter(account=>account.role==='merchant').forEach(account=>add(account.lat,account.lng,account.name,'merchant',`merchant-${account.id}`));
    if(state.location)add(state.location.lat,state.location.lng,'Sua localização','driver','me');
    if(points.length)state.map.fitBounds(points,{padding:[40,40],maxZoom:14});
    else $('#map-status').textContent='Nenhuma localização disponível. O mapa inicia em São Paulo e acompanha os cadastros da operação.';
    setTimeout(()=>state.map?.invalidateSize(),100);
  }
  async function refresh({force=false}={}) {
    if(!state.user||state.polling) return;
    state.polling=true;
    try {
      const result=await api('/api/state');state.data=result.state||result;
      if(state.user.role==='support'){const [accounts,deletions]=await Promise.all([api('/api/accounts'),api('/api/deletion-requests')]);state.accounts=accounts.accounts||accounts;state.deletionRequests=deletions.requests;}
      if(isAndroid()&&state.user.role==='driver'){try{state.nativeTracking=Boolean((await android.request('trackingStatus')).tracking);}catch{state.nativeTracking=false;}}
      state.offline=false;
      if(force)renderShell();else renderPageIfChanged();
      if(state.user.role==='driver'&&ownDriver()?.online&&!ownDriver()?.suspended)startLocation();else stopLocation();
      if($('#connection-status'))$('#connection-status').innerHTML='<span class="dot"></span>Conectado';
    } catch(error) {
      if(error.status===401){authView();return;}
      state.offline=true;
      if($('#connection-status'))$('#connection-status').innerHTML='<span class="dot gray"></span>Reconectando';
      if(force)throw error;
    } finally {state.polling=false;}
  }
  function showOrder(id) {
    const order=state.data.orders.find(item=>item.id===id);if(!order)return toast('Esta entrega não está disponível no seu perfil.');
    const role=state.user.role;
    const driver=state.data.drivers.find(item=>item.id===order.driverId);
    let actions='';
    if(role==='merchant'&&!order.ready&&['awaiting_customer','searching','accepted'].includes(order.status))actions+=button('Marcar como pronto','ready',{id,primary:true,symbol:'check'});
    if(role==='driver'&&order.status==='searching')actions+=button('Aceitar corrida','accept',{id,primary:true,symbol:'bike'});
    if(role==='merchant'&&order.status==='accepted'&&order.ready)actions+=button('Confirmar retirada','pickup-form',{id,primary:true,symbol:'package'});
    if(isAndroid()&&role==='driver'&&order.driverId===state.user.id&&activeOrder(order))actions+=button(order.pickedUpAt?'Abrir rota de entrega':'Abrir rota de retirada','navigate',{id,symbol:'map'});
    if(role==='driver'&&order.status==='in_transit')actions+=button('Confirmar entrega','deliver-form',{id,primary:true,symbol:'check'});
    if(role==='driver'&&order.driverId===state.user.id&&order.pickedUpAt&&['in_transit','incident'].includes(order.status)){actions+=button('Contato com cliente','contact-customer-form',{id,symbol:'phone'});actions+=button('Contato com loja','contact-merchant-form',{id,symbol:'store'});}
    if(role==='support'&&(order.status==='incident'||order.held))actions+=button('Analisar ocorrência','resolve',{id,primary:true,symbol:'shield'});
    if(!['incident','cancelled','returned'].includes(order.status)&&(role==='merchant'||(role==='driver'&&order.driverId===state.user.id)))actions+=button('Registrar ocorrência','report-form',{id,symbol:'alert'});
    if(activeOrder(order)&&order.status!=='incident'&&role==='merchant')actions+=button('Solicitar cancelamento','cancel-form',{id,className:'danger'});
    const link=role==='merchant'?customerLink(order):'';
    const events=order.events||[];
    setDialog(`Entrega #${order.reference||order.id.slice(0,8)}`,`${badge(order.status)}${order.held?' <span class="badge incident">Valores retidos para análise</span>':''}<div class="divider"></div><div class="detail-grid"><div class="detail-item">Estabelecimento<strong>${esc(order.merchantName)}</strong></div><div class="detail-item">Preparação<strong>${order.ready?'Pronto para retirada':'Em preparação'}</strong></div><div class="detail-item">Retirada<strong>${esc(order.merchantAddress||'Endereço não informado')}</strong></div><div class="detail-item">Contato do estabelecimento<strong>${phoneLink(order.merchantPhone)}</strong></div><div class="detail-item">Entregador<strong>${esc(driver?.name|| (order.driverId?'Entregador designado':'Aguardando aceite'))}</strong></div><div class="detail-item">Cliente<strong>${esc(order.customerName||'Liberado após a retirada')}</strong></div><div class="detail-item">Contato do cliente<strong>${order.customerPhone?phoneLink(order.customerPhone):'Liberado após a retirada'}</strong></div><div class="detail-item">Destino<strong>${esc(order.destinationAddress||'Endereço liberado após a retirada')}</strong></div><div class="detail-item">Percurso informado pela loja<strong>${number(order.distanceKm)} km</strong></div></div>${order.pickupCode?`<div class="code-block">Apresente este código ao estabelecimento<strong>${esc(order.pickupCode)}</strong><p>A loja confirma a retirada quando o pedido estiver pronto.</p></div>`:''}<div class="divider"></div><div class="quote"><div class="quote-row"><span>Participação do estabelecimento</span><strong>${money(order.merchantCents)}</strong></div><div class="quote-row"><span>Participação do cliente</span><strong>${money(order.customerCents)}</strong></div><div class="quote-row total"><span>Frete total</span><strong>${money(order.totalCents)}</strong></div>${order.compensationCents!=null?`<div class="quote-row"><span>Compensação aprovada</span><strong>${money(order.compensationCents)}</strong></div>`:''}</div>${link?`<p class="inline-note">Envie este link ao cliente para ele conferir e aprovar sua participação no frete.</p><div class="link-box"><input readonly aria-label="Link de aprovação do cliente" value="${esc(link)}"><button class="icon-button" data-action="copy-link" data-value="${esc(link)}" aria-label="Copiar link">${icon('copy')}</button><a href="${esc(link)}" target="_blank" rel="noopener">Abrir</a></div>`:''}<div class="detail-actions">${actions}</div>${events.length?`<div class="divider"></div><h3>Histórico da entrega</h3><ol class="timeline">${events.slice().reverse().map(event=>`<li><p>${esc(eventNames[event.type]||event.type)}${event.note?` · ${esc(event.note)}`:''}</p><small>${date(event.createdAt)}</small></li>`).join('')}</ol>`:''}`);
  }
  function quoteMarkup(distance,subsidy) {
    const config=state.data.settings,extra=Math.round(Math.max(0,distance-config.baseKm)*config.extraKmCents),total=config.baseCents+extra;
    const merchant=subsidy==='full'?total:subsidy==='half'?config.baseCents/2:config.baseCents;
    return `<div class="quote-row"><span>Base · até ${number(config.baseKm)} km</span><strong>${money(config.baseCents)}</strong></div><div class="quote-row"><span>Quilômetros adicionais</span><strong>${money(extra)}</strong></div><div class="quote-row"><span>Estabelecimento paga</span><strong>${money(merchant)}</strong></div><div class="quote-row"><span>Cliente paga</span><strong>${money(total-merchant)}</strong></div><div class="quote-row total"><span>Frete total</span><strong>${money(total)}</strong></div>`;
  }
  function newOrder() {
    setDialog('Nova entrega',`<form data-form="new-order"><div class="form-grid">${field('Referência do pedido','reference',{placeholder:'Ex.: 1042',attrs:'maxlength="80"',span:true})}${field('Nome do cliente','customerName',{placeholder:'Nome completo',attrs:'autocomplete="off" maxlength="120"'})}${field('Celular do cliente','customerPhone',{type:'tel',placeholder:'(11) 99999-9999',attrs:'maxlength="30"'})}${field('Últimos 4 números do CPF','customerCpfLast4',{type:'password',placeholder:'••••',attrs:'inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="off"',hint:'Código informado pelo cliente ao receber. Não peça o CPF completo.',span:true})}${field('Endereço completo da entrega','destinationAddress',{placeholder:'Rua, número, bairro, cidade e complemento',attrs:'maxlength="300"',span:true})}${field('Latitude do destino','destinationLat',{type:'number',placeholder:'-23.5505',attrs:'min="-90" max="90" step="any"'})}${field('Longitude do destino','destinationLng',{type:'number',placeholder:'-46.6333',attrs:'min="-180" max="180" step="any"'})}<p class="form-hint span-2">Informe as coordenadas conferidas do endereço para exibi-lo no mapa.</p>${field('Distância do percurso (km)','distanceKm',{type:'number',value:'5',attrs:'min="0.01" max="1000" step="0.01"',hint:'Conferida pelo estabelecimento. Considere a rota pelas ruas.',span:true})}<label class="field span-2">Quem participa do frete?<select name="subsidy"><option value="base">Loja paga a base; cliente paga o excedente</option><option value="half">Base meio a meio; cliente paga o excedente</option><option value="full">Loja paga o frete inteiro</option></select></label><div class="quote span-2" id="order-quote">${quoteMarkup(5,'base')}</div><label class="checkbox span-2"><input type="checkbox" name="ready">O pedido já está pronto para retirada.</label><p class="form-hint span-2">Se houver valor para o cliente, compartilhe o link de aprovação. A corrida só será disponibilizada após o aceite.</p></div>${formError}${formActions('Criar entrega')}</form>`);
  }
  function newAccount() {
    setDialog('Cadastrar na operação',`<form data-form="new-account"><div class="form-grid"><label class="field span-2">Perfil<select name="role"><option value="merchant">Estabelecimento</option><option value="driver">Entregador</option></select></label>${field('Nome','name',{placeholder:'Nome da loja ou do entregador',attrs:'maxlength="120"',span:true})}${field('Usuário de acesso','username',{placeholder:'nome.usuario',attrs:'minlength="3" maxlength="80" pattern="[a-zA-Z0-9._@+\\-]{3,80}" autocomplete="off" autocapitalize="none"',hint:'Letras, números, ponto, @, +, hífen ou sublinhado.'})}${field('Senha inicial','password',{type:'password',placeholder:'Pelo menos 10 caracteres',attrs:'minlength="10" maxlength="128" autocomplete="new-password"'})}${field('Telefone','phone',{type:'tel',placeholder:'(11) 99999-9999',attrs:'maxlength="30"',span:true})}<div class="form-grid span-2" id="merchant-fields">${field('Endereço de retirada','address',{placeholder:'Rua, número, bairro e cidade',attrs:'maxlength="300"',span:true})}${field('Latitude da loja','lat',{type:'number',placeholder:'-23.5505',attrs:'min="-90" max="90" step="any"'})}${field('Longitude da loja','lng',{type:'number',placeholder:'-46.6333',attrs:'min="-180" max="180" step="any"'})}<div class="span-2">${button('Usar minha localização','account-location',{symbol:'locate',className:'compact'})}<p class="form-hint">Use esta opção apenas se estiver no endereço do estabelecimento.</p></div></div></div>${formError}${formActions('Criar acesso')}</form>`);
    $('#merchant-fields').insertAdjacentHTML('beforeend', field('ID da loja no delivery','onlineEstablishmentId',{type:'number',placeholder:'Ex.: 123',attrs:'min="1" step="1"',hint:'Use o ID do estabelecimento no sistema de vendas para receber seus pedidos automaticamente.',span:true}));
  }
  function codeForm(id,action) {
    const pickup=action==='pickup';
    setDialog(pickup?'Confirmar retirada':'Confirmar entrega',`<form data-form="code" data-id="${esc(id)}" data-kind="${action}"><p class="form-hint">${pickup?'O entregador informa o código de 6 números exibido na conta dele. Confirme somente depois de entregar o pedido pronto.':'Peça ao cliente os últimos 4 números do CPF informado na compra. Confirme somente depois de entregar o pedido.'}</p><div class="divider"></div>${field(pickup?'Código de retirada (6 números)':'Código de entrega (4 números)','code',{type:'password',placeholder:pickup?'••••••':'••••',attrs:`inputmode="numeric" pattern="[0-9]{${pickup?6:4}}" minlength="${pickup?6:4}" maxlength="${pickup?6:4}" autocomplete="off"`})}${formError}${formActions(pickup?'Confirmar retirada':'Concluir entrega')}</form>`);
  }
  function noteForm(id,kind) {
    const labels={'contact-customer':'Registrar contato com cliente','contact-merchant':'Registrar contato com estabelecimento',report:'Registrar ocorrência',cancel:'Solicitar cancelamento'};
    setDialog(labels[kind],`<form data-form="order-note" data-id="${esc(id)}" data-kind="${kind}"><div class="form-grid">${kind==='report'?'<label class="field span-2">Motivo<select name="kind"><option value="unreachable">Cliente não localizado</option><option value="fraud">Suspeita de irregularidade</option><option value="other">Outro problema</option></select></label>':''}<label class="field span-2">${kind.startsWith('contact')?'Como foi a tentativa de contato?':'Descreva o ocorrido'}<textarea name="note" required minlength="5" maxlength="1000" placeholder="Registre os detalhes para que o suporte possa acompanhar."></textarea></label><p class="form-hint span-2">${kind==='cancel'?'Cancelamentos após a retirada do produto são analisados pelo suporte. Informe o motivo e a situação do produto.':kind==='report'?'Cliente não localizado: registre primeiro a tentativa de contato com o cliente e, em seguida, com o estabelecimento. Suspeitas de irregularidade são encaminhadas para análise.':'Informe o resultado do contato. Não registre códigos de confirmação ou dados de documentos nesta descrição.'}</p></div>${formError}${formActions('Registrar')}</form>`);
  }
  function resolveForm(id) {
    const order=state.data.orders.find(item=>item.id===id);
    setDialog('Analisar ocorrência',`<form data-form="resolve" data-id="${esc(id)}"><p class="form-hint">Pedido #${esc(order?.reference||id.slice(0,8))} · Frete de ${money(order?.totalCents)}</p><div class="divider"></div><div class="form-grid"><label class="field span-2">Resultado da análise<select name="resolution"><option value="resume">${order?.status==='delivered'?'Liberar os valores retidos':'Retomar a entrega'}</option>${order?.status!=='delivered'?`${order?.pickedUpAt?'<option value="returned">Confirmar devolução ao estabelecimento</option>':''}<option value="cancelled">Confirmar cancelamento</option>`:''}</select></label>${order?.pickedUpAt&&order.status!=='delivered'?field('Compensação ao entregador (R$)','compensation',{type:'number',required:false,placeholder:'Informe o valor, inclusive se for zero',attrs:`min="0" max="${Number(order.totalCents)/100}" step="0.01"`,hint:'Obrigatório para devolução ou cancelamento após retirada. Máximo: o valor do frete.',span:true}):''}<label class="field span-2">Justificativa<textarea name="note" required minlength="5" maxlength="1000" placeholder="Registre o que foi apurado e como o produto foi tratado."></textarea></label></div>${formError}${formActions('Concluir análise')}</form>`);
  }
  function weekStartPrevious() {const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7)-7);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function currentLocation() {
    return new Promise((resolve,reject)=>{
      if(!navigator.geolocation)return reject(new Error('Este navegador não oferece localização. Use um navegador atualizado com acesso por HTTPS ou localhost.'));
      navigator.geolocation.getCurrentPosition(position=>{const coords={lat:position.coords.latitude,lng:position.coords.longitude};state.location=coords;resolve(coords);},error=>reject(new Error(error.code===1?'Permita o acesso à localização nas configurações do navegador e tente novamente.':'Não conseguimos obter sua localização. Ative o GPS e tente novamente.')),{enableHighAccuracy:true,timeout:15000,maximumAge:0});
    });
  }
  function stopLocation() {
    if(state.watch!==null&&navigator.geolocation){navigator.geolocation.clearWatch(state.watch);state.watch=null;}
    if(state.heartbeat!==null){clearInterval(state.heartbeat);state.heartbeat=null;}
  }
  function startLocation() {
    if(isAndroid())return;
    if(state.watch!==null||!navigator.geolocation)return;
    let lastSent=0;
    state.watch=navigator.geolocation.watchPosition(position=>{
      const coords={lat:position.coords.latitude,lng:position.coords.longitude};state.location=coords;
      if(Date.now()-lastSent<15000)return;lastSent=Date.now();
      api('/api/location',{method:'POST',body:coords}).catch(error=>{if(error.status===401)stopLocation();});
    },()=>{toast('Localização indisponível. Verifique a permissão e o GPS para atualizar sua posição.');},{enableHighAccuracy:true,maximumAge:10000,timeout:20000});
    state.heartbeat=setInterval(async()=>{
      if(!state.user||state.user.role!=='driver'||!ownDriver()?.online||ownDriver()?.suspended)return;
      try {const coords=await currentLocation();await api('/api/location',{method:'POST',body:coords});}catch {if($('#connection-status'))$('#connection-status').innerHTML='<span class="dot gray"></span>Verifique o GPS';}
    },45000);
  }
  async function actionHandler(action,element) {
    if(action==='driver-signup') return driverAuthView(true);
    if(action==='driver-login') return driverAuthView(false);
    const id=element.dataset.id;
    if(action==='close-dialog')return closeDialog();
    if(action==='logout'){
      if(state.user?.role==='driver'){
        if(isAndroid())await android.request('stopTracking').catch(()=>{});
        await api('/api/availability',{method:'POST',body:{online:false}}).catch(()=>{});
      }
      await api('/api/logout',{method:'POST',body:{}});authView();return;
    }
    if(action==='new-order')return newOrder();
    if(action==='new-account')return newAccount();
    if(action==='order')return showOrder(id);
    if(action==='pickup-form')return codeForm(id,'pickup');
    if(action==='deliver-form')return codeForm(id,'deliver');
    if(action==='report-form')return noteForm(id,'report');
    if(action==='cancel-form')return noteForm(id,'cancel');
    if(action==='contact-customer-form')return noteForm(id,'contact-customer');
    if(action==='contact-merchant-form')return noteForm(id,'contact-merchant');
    if(action==='resolve')return resolveForm(id);
    if(action==='navigate'){
      const order=state.data.orders.find(item=>item.id===id);if(!order)return;
      await android.request('navigate',order.pickedUpAt?{lat:order.destinationLat,lng:order.destinationLng,label:order.destinationAddress}:{lat:order.merchantLat,lng:order.merchantLng,label:order.merchantName});return;
    }
    if(action==='copy-link'){
      if(isAndroid()){await android.request('share',{text:element.dataset.value});return;}
      try {await navigator.clipboard.writeText(element.dataset.value);toast('Link copiado. Compartilhe com o cliente.');}
      catch {const input=element.closest('.link-box')?.querySelector('input');input?.select();toast('Selecione e copie o link exibido.');}
      return;
    }
    if(action==='locate'){const coords=await currentLocation();if(state.map){state.map.setView([coords.lat,coords.lng],14);window.L.circleMarker([coords.lat,coords.lng],{radius:7,color:'#fff',weight:3,fillColor:'#4279ab',fillOpacity:1}).addTo(state.markerLayer);}return;}
    if(action==='account-location'){const coords=await currentLocation();const form=element.closest('form');form.elements.lat.value=coords.lat.toFixed(6);form.elements.lng.value=coords.lng.toFixed(6);return;}
    if(action==='availability'){
      const online=!driverOnline();
      const coords=online?(isAndroid()?await android.request('prepareTracking'):await currentLocation()):{};
      if(!online&&isAndroid())await android.request('stopTracking');
      await api('/api/availability',{method:'POST',body:{online,...coords}});
      if(online&&isAndroid()){
        try{await android.request('startTracking');state.nativeTracking=true;}
        catch(error){await api('/api/availability',{method:'POST',body:{online:false}}).catch(()=>{});throw error;}
      }else if(!online){state.nativeTracking=false;}
      toast(online?'Você está online e pode aceitar corridas.':'Você está offline.');await refresh();return;
    }
    if(action==='ready'||action==='accept'){
      if(action==='accept'&&isAndroid()&&!driverOnline())throw new Error('Toque em Ficar online para ativar o acompanhamento Android antes de aceitar.');
      await api(`/api/orders/${encodeURIComponent(id)}/${action}`,{method:'POST',body:{}});
      $('#dialog').close();await refresh();toast(action==='ready'?'Pedido pronto para retirada.':'Corrida aceita. Vá até o estabelecimento.');showOrder(id);return;
    }
    if(action==='review-driver'){
      const driver=state.data.drivers.find(item=>item.id===id),suspended=Boolean(driver?.approved&&!driver?.suspended);
      return setDialog(suspended?'Suspender entregador':'Liberar entregador',`<form data-form="review-driver" data-id="${esc(id)}" data-suspended="${suspended}"><p class="form-hint">${esc(driver?.name)} · ${suspended?'O entregador ficará indisponível para aceitar novas corridas.':'O entregador poderá ficar online e aceitar novas corridas.'}</p><div class="divider"></div><label class="field">Justificativa da análise<textarea name="note" required minlength="5" maxlength="1000" placeholder="Descreva os fatos e o motivo da decisão."></textarea></label>${formError}${formActions(suspended?'Suspender acesso':'Liberar acesso')}</form>`);
    }
    if(action==='close-week')return setDialog('Fechamento semanal',`<form data-form="close-week"><p class="form-hint">Escolha a segunda-feira de uma semana já encerrada. Cada entrega é incluída uma única vez. Compensações aprovadas entram na semana da decisão.</p><div class="divider"></div>${field('Semana iniciada em (segunda-feira)','weekStart',{type:'date',value:weekStartPrevious()})}${formError}${formActions('Gerar fechamentos')}</form>`);
    if(action==='paid'){
      const settlement=state.data.settlements.find(item=>item.id===id);
      return setDialog('Registrar pagamento realizado',`<form data-form="paid" data-id="${esc(id)}"><p class="form-hint">${esc(settlement?.driverName)} · ${money(settlement?.cents)}<br>Registre somente depois de realizar o pagamento ao entregador.</p><div class="divider"></div>${field('Referência ou comprovante do pagamento','reference',{placeholder:'Ex.: identificador da transferência',attrs:'minlength="3" maxlength="200"'})}${formError}${formActions('Marcar como pago')}</form>`);
    }
    if(action==='customer-accept'||action==='customer-decline') {
      await api(`/api/customer/${encodeURIComponent(state.customerToken)}`,{method:'POST',body:{accept:action==='customer-accept'}});
      toast(action==='customer-accept'?'Sua participação no frete foi aprovada.':'Sua participação no frete foi recusada.');await customerView();return;
    }
  }
  async function submitForm(form) {
    const data=Object.fromEntries(new FormData(form)),type=form.dataset.form;
    if(type==='driver-register'){
      const result=await api('/api/driver/register',{method:'POST',body:{...data,username:data.username.trim().toLowerCase()}});
      state.user=result.user;state.view='overview';await refresh({force:true});toast('Cadastro recebido. Aguarde a aprovação do suporte.');return;
    }
    if(type==='login'||type==='setup'){
      const result=await api(`/api/${type}`,{method:'POST',body:data});
      if((driverMode && result.user.role!=='driver')||(!driverMode && result.user.role==='merchant')){
        await api('/api/logout',{method:'POST',body:{}});
        throw new Error(driverMode?'Este aplicativo é exclusivo para entregadores.':'O estabelecimento acessa as entregas pelo DoixP Delivery.');
      }
      state.user=result.user;state.view='overview';await refresh({force:true});return;
    }
    if(type==='new-account'){
      const body={...data,username:data.username.trim().toLowerCase()};
      if(data.role==='merchant'){body.lat=Number(data.lat);body.lng=Number(data.lng);}else{delete body.lat;delete body.lng;delete body.address;delete body.onlineEstablishmentId;}
      await api('/api/accounts',{method:'POST',body});toast('Acesso criado. Informe o usuário e a senha ao participante.');
    }else if(type==='new-order'){
      const body={...data,distanceKm:Number(data.distanceKm),destinationLat:Number(data.destinationLat),destinationLng:Number(data.destinationLng),ready:form.elements.ready.checked};
      const result=await api('/api/orders',{method:'POST',body});const order=result.order||result;
      form.elements.customerCpfLast4.value='';
      $('#dialog').close();await refresh();toast('Entrega criada.');
      const stored=state.data.orders.find(item=>item.id===order.id);if(stored&&!stored.customerToken)stored.customerToken=result.customerToken||order.customerToken;
      showOrder(order.id);return;
    }else if(type==='code'){
      await api(`/api/orders/${encodeURIComponent(form.dataset.id)}/${form.dataset.kind}`,{method:'POST',body:{code:data.code}});form.elements.code.value='';toast(form.dataset.kind==='pickup'?'Retirada confirmada. Boa entrega!':'Entrega concluída. Valor registrado para o fechamento semanal.');
    }else if(type==='order-note'){
      await api(`/api/orders/${encodeURIComponent(form.dataset.id)}/${form.dataset.kind}`,{method:'POST',body:data});toast('Registro salvo no histórico da entrega.');
    }else if(type==='resolve'){
      const body={resolution:data.resolution,note:data.note};
      if(form.elements.compensation&&data.resolution!=='resume'){
        if(data.compensation==='')throw new Error('Informe o valor da compensação, inclusive se for R$ 0,00.');
        body.compensationCents=Math.round(Number(data.compensation)*100);
      }
      await api(`/api/orders/${encodeURIComponent(form.dataset.id)}/resolve`,{method:'POST',body});toast('Análise registrada.');
    }else if(type==='settings'){
      await api('/api/settings',{method:'PATCH',body:{extraKmCents:Math.round(Number(data.extraKm)*100)}});toast('Tarifa atualizada para novos pedidos.');delete form.dataset.dirty;state.rendered='';await refresh();return;
    }else if(type==='review-driver'){
      await api(`/api/drivers/${encodeURIComponent(form.dataset.id)}/review`,{method:'POST',body:{suspended:form.dataset.suspended==='true',note:data.note}});toast('Situação do entregador atualizada.');
    }else if(type==='close-week'){
      await api('/api/settlements/close',{method:'POST',body:data});toast('Fechamentos da semana processados.');
    }else if(type==='paid'){
      await api(`/api/settlements/${encodeURIComponent(form.dataset.id)}/paid`,{method:'POST',body:data});toast('Pagamento registrado.');
    }
    $('#dialog').close();await refresh();
  }
  async function customerView() {
    const result=await api(`/api/customer/${encodeURIComponent(state.customerToken)}`);const order=result.order||result;
    const pending=order.status==='awaiting_customer';
    const refused=order.status==='cancelled';
    const title=pending?'Sua entrega está quase a caminho.':refused?'Esta entrega foi cancelada.':order.status==='delivered'?'Sua entrega chegou.':'Estamos cuidando da sua entrega.';
    $('#app').innerHTML=`<main class="customer-page">${brand()}<section class="card customer-card"><div class="customer-top"><div class="empty-icon">${icon(order.status==='delivered'?'check':'bike')}</div><span class="eyebrow">${esc(order.merchantName||'Seu pedido')}</span><h1>${title}</h1><p>Pedido #${esc(order.reference||order.id?.slice(0,8)||'')} · ${number(order.distanceKm)} km</p></div><div class="customer-body">${pending?`<div class="customer-total"><small>Sua participação no frete</small>${money(order.customerCents)}</div><p class="form-hint" style="margin-top:12px">Aprove este valor para que possamos chamar um entregador para o seu pedido.</p>`:`<div class="row-head"><strong>Etapa da entrega</strong>${badge(order.status)}</div>`}<div class="divider"></div><div class="quote"><div class="quote-row"><span>Frete total</span><strong>${money(order.totalCents)}</strong></div><div class="quote-row"><span>O estabelecimento paga</span><strong>${money(order.merchantCents)}</strong></div><div class="quote-row"><span>Você paga</span><strong>${money(order.customerCents)}</strong></div></div>${pending?`<div class="customer-buttons">${button(`Aprovar ${money(order.customerCents)} de frete`,'customer-accept',{primary:true,symbol:'check'})}${button('Não aprovar a entrega','customer-decline')}</div><p class="inline-note">O aceite autoriza sua participação no frete. O pagamento deve ser combinado com o estabelecimento; esta tela não realiza cobranças.</p>`:refused?'<p class="inline-note">Fale com o estabelecimento para combinar os próximos passos do seu pedido.</p>':'<p class="inline-note">Ao receber seu pedido, informe ao entregador os últimos 4 números do CPF usado na compra. Informe o código somente depois de receber o produto.</p>'}</div></section><p class="customer-footer">${icon('shield')} Sua entrega é confirmada em cada etapa.<br>DoixP Entregas · Conexões que chegam mais longe.</p></main>`;
  }
  document.addEventListener('click',async event=>{
    const view=event.target.closest('[data-view]');
    if(view){state.view=view.dataset.view;renderPage();return;}
    const filter=event.target.closest('[data-filter]');
    if(filter){state.filter=filter.dataset.filter;renderPage();return;}
    const element=event.target.closest('[data-action]');if(!element)return;
    event.preventDefault();const disabled=element.disabled;element.disabled=true;
    try {await actionHandler(element.dataset.action,element);}catch(error){toast(error.message);}finally{element.disabled=disabled;}
  });
  document.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('.delivery-row')){event.preventDefault();showOrder(event.target.dataset.id);}});
  document.addEventListener('submit',async event=>{
    const form=event.target.closest('form[data-form]');if(!form)return;event.preventDefault();
    const error=$('.form-error',form);if(error)error.textContent='';
    const submit=$('button[type="submit"]',form);if(submit)submit.disabled=true;
    try{await submitForm(form);}catch(problem){if(error)error.textContent=problem.message;else toast(problem.message);}finally{if(submit)submit.disabled=false;}
  });
  document.addEventListener('input',event=>{
    const form=event.target.closest('form');
    if(form)form.dataset.dirty='true';
    if(form?.dataset.form==='new-order'&&['distanceKm','subsidy'].includes(event.target.name))$('#order-quote').innerHTML=quoteMarkup(Number(form.elements.distanceKm.value)||0,form.elements.subsidy.value);
  });
  document.addEventListener('change',event=>{
    const form=event.target.closest('form');
    if(form?.dataset.form==='new-account'&&event.target.name==='role'){
      const merchant=event.target.value==='merchant';$('#merchant-fields').style.display=merchant?'':'none';$('#merchant-fields').querySelectorAll('input').forEach(input=>{input.required=merchant&&input.name!=='onlineEstablishmentId';input.disabled=!merchant;});
    }
    if(form?.dataset.form==='new-order'&&event.target.name==='subsidy')$('#order-quote').innerHTML=quoteMarkup(Number(form.elements.distanceKm.value)||0,form.elements.subsidy.value);
  });
  $('#dialog').addEventListener('close',()=>renderPageIfChanged());
  $('#dialog').addEventListener('click',event=>{if(event.target===$('#dialog')){const rect=$('#dialog').getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeDialog();}});
  async function start() {
    try {
      if(state.customerToken){await customerView();return;}
      if(!driverMode){const setup=await api('/api/bootstrap');if(setup.needsSetup){authView(true);return;}}
      try{const result=await api('/api/me');
        if((driverMode&&result.user.role!=='driver')||(!driverMode&&result.user.role==='merchant')){authView();return;}
        state.user=result.user;await refresh({force:true});
      }catch(error){if(error.status===401)authView();else throw error;}
    }catch(error){$('#app').innerHTML=`<main class="boot">${brand()}<section class="card" style="max-width:450px;margin:20px"><div class="empty"><div class="empty-icon">${icon('alert')}</div><h3>Não foi possível carregar a plataforma</h3><p>${esc(error.message)}</p><a class="btn primary" href="${state.customerToken?`/?cliente=${encodeURIComponent(state.customerToken)}`:'/'}">Tentar novamente</a></div></section></main>`;}
  }
  setInterval(()=>{if(document.visibilityState!=='visible')return;if(state.customerToken){if(!document.activeElement?.closest('button'))customerView().catch(()=>{});}else refresh();},8000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.user)refresh();});
  window.addEventListener('pagehide',stopLocation);
  start();
})();
