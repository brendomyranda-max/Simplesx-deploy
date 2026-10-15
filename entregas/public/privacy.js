(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin', cache: 'no-store',
      ...(options.body !== undefined ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options.body),
      } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || 'Não foi possível concluir a operação.'), { status: response.status });
    return data;
  }

  async function loadConfiguration() {
    const notice = byId('configuration-notice');
    try {
      const config = await api('/api/privacy-public');
      document.querySelectorAll('[data-operator]').forEach(element => { element.textContent = config.operator; });
      document.querySelectorAll('[data-contact]').forEach(element => {
        element.textContent = config.configured
          ? `Contato de privacidade da operação: ${config.contact}`
          : 'O contato de privacidade ainda não foi configurado pelo responsável pela operação.';
      });
      notice.textContent = config.configured
        ? 'Esta versão registra solicitações para atendimento humano pelo suporte. O responsável deve definir e comunicar o procedimento e os prazos de retenção e exclusão antes do lançamento público.'
        : 'Operação em preparação: contato de privacidade, prazos de retenção e processo de atendimento ainda precisam ser configurados antes do lançamento público. Você pode registrar uma solicitação; isso não representa exclusão concluída.';
    } catch {
      notice.textContent = 'Não foi possível consultar o contato da operação. Verifique a conexão e recarregue esta página. Nenhum contato de privacidade foi confirmado.';
      document.querySelectorAll('[data-contact]').forEach(element => { element.textContent = 'Contato de privacidade indisponível no momento.'; });
    }
  }

  function setSession(user) {
    byId('login-section').hidden = Boolean(user);
    byId('request-section').hidden = !user;
    byId('session-status').textContent = user
      ? `Conta identificada: ${user.name} (${user.username}).`
      : 'Entre com a conta que deseja excluir para registrar sua solicitação.';
    if (!user) {
      byId('privacy-history').replaceChildren();
      byId('request-result').hidden = true;
      byId('request-button').disabled = false;
    }
  }

  function renderRequests(requests) {
    const history = byId('privacy-history');
    history.replaceChildren();
    byId('history-empty').hidden = requests.length > 0;
    for (const request of requests) {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = `Protocolo ${request.id}`;
      const status = document.createElement('p');
      status.textContent = request.status === 'pending'
        ? 'Solicitação registrada para análise e atendimento pelo suporte. Exclusão ainda não concluída.'
        : `Situação: ${request.status}`;
      const time = document.createElement('p');
      time.className = 'muted';
      time.textContent = `Registrada em ${new Date(request.createdAt).toLocaleString('pt-BR')}.`;
      item.append(title, status, time);
      if (request.note) {
        const note = document.createElement('p');
        note.textContent = `Sua observação: ${request.note}`;
        item.append(note);
      }
      history.append(item);
    }
    const pending = requests.some(request => request.status === 'pending');
    byId('request-button').disabled = pending;
    byId('request-button').textContent = pending
      ? 'Você já possui uma solicitação pendente'
      : 'Solicitar exclusão da conta e dos dados';
  }

  async function loadRequests() {
    const data = await api('/api/account-deletion');
    renderRequests(data.requests);
  }

  async function loadSession() {
    try {
      const { user } = await api('/api/me');
      setSession(user);
      await loadRequests();
    } catch (error) {
      if (error.status === 401) setSession(null);
      else byId('session-status').textContent = 'Não foi possível carregar sua conta. Verifique a conexão e recarregue a página.';
    }
  }

  loadConfiguration();
  if (document.body.dataset.page !== 'deletion') return;
  loadSession();

  byId('privacy-login').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    button.disabled = true;
    byId('login-error').textContent = '';
    try {
      const { user } = await api('/api/login', { body: {
        username: form.elements.username.value,
        password: form.elements.password.value,
      } });
      setSession(user);
      await loadRequests();
    } catch (error) {
      if (error.status === 401) setSession(null);
      byId('login-error').textContent = error.message;
      if (byId('login-section').hidden) byId('request-error').textContent = error.message;
    } finally {
      form.elements.password.value = '';
      button.disabled = false;
    }
  });

  byId('privacy-request').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = byId('request-button');
    button.disabled = true;
    byId('request-error').textContent = '';
    byId('request-result').hidden = true;
    let registered = false;
    try {
      const { request, created } = await api('/api/account-deletion', { body: { note: form.elements.note.value } });
      registered = true;
      const result = byId('request-result');
      result.textContent = `${created ? 'Solicitação registrada para o suporte.' : 'Sua solicitação já está registrada.'} Protocolo: ${request.id}. A exclusão ainda não foi concluída.`;
      result.hidden = false;
      form.elements.note.value = '';
      // Preserve the confirmed result if refreshing the history loses connectivity.
      renderRequests([request]);
      await loadRequests();
    } catch (error) {
      if (error.status === 401) {
        setSession(null);
        byId('login-error').textContent = 'Sua sessão expirou. Entre novamente para continuar.';
      } else byId('request-error').textContent = registered
        ? 'A solicitação foi registrada, mas não foi possível atualizar o histórico. Recarregue a página para consultar.'
        : error.message;
    } finally {
      if (!registered) button.disabled = false;
    }
  });
})();
