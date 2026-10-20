/** Seleção explícita de endereço, GPS e confirmação do ponto no mapa. */
import { Component, lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Crosshair, Loader2, MapPin, Search } from 'lucide-react';
import { onlinePublicApi } from '@/lib/api';
import { coordenadaClienteValida, obterLocalizacaoAtual, type PontoCliente } from '@/lib/localizacao-cliente';
import './seletor-localizacao.css';

const MapaLocalizacao = lazy(() => import('./MapaLocalizacao'));

class MapaSeguro extends Component<{ children: ReactNode }, { falhou: boolean }> {
  state = { falhou: false };
  static getDerivedStateFromError() { return { falhou: true }; }
  render() {
    return this.state.falhou
      ? <p className="seletor-localizacao-aviso" role="status">Não foi possível abrir o mapa. O ponto selecionado continua confirmado; confira o endereço e tente novamente mais tarde.</p>
      : this.props.children;
  }
}

type OpcaoLocalizacao = {
  latitude: number;
  longitude: number;
  endereco: string;
  fonte?: string;
  precisao?: string;
};

export type SeletorLocalizacaoProps = {
  value: PontoCliente | null;
  onChange: (ponto: PontoCliente | null) => void;
  endereco: string;
  onEnderecoChange: (endereco: string) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
};

function mensagemErro(erro: unknown, padrao: string) {
  if (erro && typeof erro === 'object') {
    if ('error' in erro && typeof erro.error === 'string') return erro.error;
    if ('message' in erro && typeof erro.message === 'string') return erro.message;
  }
  return padrao;
}

export function SeletorLocalizacao({
  value,
  onChange,
  endereco,
  onEnderecoChange,
  label = 'Endereço',
  required = false,
  disabled = false,
}: SeletorLocalizacaoProps) {
  const id = useId();
  const [opcoes, setOpcoes] = useState<OpcaoLocalizacao[]>([]);
  const [atividade, setAtividade] = useState<'busca' | 'gps' | 'endereco-gps' | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [manterPonto, setManterPonto] = useState(false);
  const sequencia = useRef(0);
  const montado = useRef(false);
  const enderecoEsperado = useRef(endereco);
  const atual = useRef({ value, endereco, onChange, onEnderecoChange, disabled });
  atual.current = { value, endereco, onChange, onEnderecoChange, disabled };

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; sequencia.current += 1; };
  }, []);

  useEffect(() => {
    // Também cobre alterações de endereço feitas pelo formulário que contém o seletor.
    // Alterações internas já cancelam a operação necessária no próprio evento.
    if (enderecoEsperado.current === endereco) return;
    enderecoEsperado.current = endereco;
    sequencia.current += 1;
    setAtividade(null);
    setOpcoes([]);
    setManterPonto(false);
  }, [endereco]);

  useEffect(() => {
    // Preservar um ponto exige uma escolha explícita para a localização atual.
    // Completar apenas o texto não muda esta escolha; trocar o ponto a reinicia.
    setManterPonto(false);
  }, [value?.latitude, value?.longitude, value?.origem]);

  useEffect(() => {
    if (!disabled) return;
    sequencia.current += 1;
    setAtividade(null);
    setOpcoes([]);
  }, [disabled]);

  const vigente = (numero: number, texto: string) => (
    montado.current && numero === sequencia.current && !atual.current.disabled && atual.current.endereco === texto
  );

  const atualizarTexto = (texto: string) => {
    enderecoEsperado.current = texto;
    atual.current.endereco = texto;
    atual.current.onEnderecoChange(texto);
  };

  const publicarPonto = (ponto: PontoCliente | null) => {
    atual.current.value = ponto;
    atual.current.onChange(ponto);
  };

  const editarEndereco = (texto: string) => {
    sequencia.current += 1;
    setAtividade(null);
    setOpcoes([]);
    setErro('');
    const ponto = atual.current.value;
    const podeManter = manterPonto && ponto && coordenadaClienteValida(ponto.latitude, ponto.longitude);
    atualizarTexto(texto);
    if (podeManter) {
      publicarPonto({ ...ponto, endereco: texto });
      setAviso('O ponto no mapa foi mantido. Informe o endereço correspondente a ele, com número e complemento.');
    } else {
      setManterPonto(false);
      publicarPonto(null);
      setAviso('Busque o endereço e escolha uma opção para confirmar o ponto.');
    }
  };

  const buscarEndereco = async () => {
    if (atual.current.disabled) return;
    const textoOriginal = atual.current.endereco;
    const consulta = textoOriginal.trim();
    const numero = ++sequencia.current;
    setOpcoes([]);
    setErro('');
    setAviso('');
    setManterPonto(false);
    // O CEP sozinho precisa dos oito dígitos; a busca de rua requer cidade e número.
    const somenteCep = /^[\d\s.-]+$/.test(consulta);
    if (consulta.length < 5 || (somenteCep && consulta.replace(/\D/g, '').length !== 8)) {
      setAtividade(null);
      setErro('Informe rua, número e cidade, ou um CEP completo com 8 dígitos.');
      return;
    }
    setAtividade('busca');
    try {
      const resposta = await onlinePublicApi.locateOptions({ q: consulta });
      if (!vigente(numero, textoOriginal)) return;
      const encontrados = resposta.opcoes.filter((opcao) => coordenadaClienteValida(opcao.latitude, opcao.longitude)).slice(0, 5);
      setOpcoes(encontrados);
      if (!encontrados.length) {
        setErro('Nenhum endereço encontrado. Inclua bairro e cidade ou use sua localização.');
      } else {
        setAviso('Escolha o endereço correto abaixo e confira o ponto no mapa.');
      }
    } catch (falha) {
      if (vigente(numero, textoOriginal)) setErro(mensagemErro(falha, 'Não foi possível buscar o endereço. Tente novamente.'));
    } finally {
      if (vigente(numero, textoOriginal)) setAtividade(null);
    }
  };

  const escolherEndereco = (opcao: OpcaoLocalizacao) => {
    if (atual.current.disabled) return;
    sequencia.current += 1;
    setAtividade(null);
    setOpcoes([]);
    setErro('');
    setManterPonto(false);
    setAviso('Confira o número, o complemento e o ponto no mapa. Se necessário, ajuste o marcador.');
    const texto = opcao.endereco || atual.current.endereco.trim();
    atualizarTexto(texto);
    publicarPonto({ latitude: opcao.latitude, longitude: opcao.longitude, endereco: texto, origem: 'endereco', atualizado_em: Date.now() });
  };

  const usarGps = async () => {
    if (atual.current.disabled) return;
    const textoOriginal = atual.current.endereco;
    const numero = ++sequencia.current;
    setAtividade('gps');
    setOpcoes([]);
    setErro('');
    setAviso('');
    setManterPonto(false);
    publicarPonto(null);
    try {
      const ponto = await obterLocalizacaoAtual();
      if (!vigente(numero, textoOriginal)) return;
      // O endereço reverso é apenas uma descrição: nunca substitui a posição do aparelho.
      // Um endereço anterior pode pertencer a outro local e precisa ser confirmado novamente.
      atualizarTexto('');
      publicarPonto({ ...ponto, endereco: '', origem: 'gps' });
      setAtividade('endereco-gps');
      setAviso('Localização capturada. Confira o ponto no mapa e informe o número e o complemento.');
      try {
        const local = await onlinePublicApi.locate({ lat: ponto.latitude, lng: ponto.longitude });
        if (!vigente(numero, '')) return;
        const texto = local.endereco?.trim();
        if (!texto) throw new Error('Endereço não identificado');
        atualizarTexto(texto);
        publicarPonto({ ...ponto, endereco: texto, origem: 'gps' });
        setAtividade(null);
      } catch {
        if (!vigente(numero, '')) return;
        setAtividade(null);
        setAviso('Localização capturada. Não foi possível identificar o endereço. Marque “Informar endereço mantendo este ponto” e preencha rua, número e cidade.');
      }
    } catch (falha) {
      if (!vigente(numero, textoOriginal)) return;
      setAtividade(null);
      setErro(mensagemErro(falha, 'Não foi possível obter a localização. Busque o endereço ou tente novamente.'));
    }
  };

  const ajustarMapa = (coordenadas: { latitude: number; longitude: number }) => {
    if (atual.current.disabled || !coordenadaClienteValida(coordenadas.latitude, coordenadas.longitude)) return;
    sequencia.current += 1;
    setAtividade(null);
    setOpcoes([]);
    setErro('');
    setAviso('Ponto ajustado no mapa. Confira se o endereço e o número correspondem ao local indicado.');
    publicarPonto({ ...coordenadas, endereco: atual.current.endereco, origem: 'mapa', atualizado_em: Date.now() });
  };

  const mudarManterPonto = (ativar: boolean) => {
    if (atual.current.disabled) return;
    const ponto = atual.current.value;
    if (ativar && (!ponto || !coordenadaClienteValida(ponto.latitude, ponto.longitude))) return;
    sequencia.current += 1;
    setAtividade(null);
    setOpcoes([]);
    setErro('');
    setManterPonto(ativar);
    setAviso(ativar
      ? 'Preencha o endereço correspondente ao ponto indicado no mapa. As coordenadas serão mantidas.'
      : 'Para escolher outro local, digite e busque o novo endereço ou ajuste o mapa.');
  };

  const pontoValido = value && coordenadaClienteValida(value.latitude, value.longitude) ? value : null;
  const precisao = pontoValido?.precisao_metros;
  const precisaoDisponivel = typeof precisao === 'number' && Number.isFinite(precisao) && precisao > 0;
  const aproximado = precisaoDisponivel && precisao > 200;

  return (
    <div className="seletor-localizacao" aria-busy={atividade !== null}>
      <label className="seletor-localizacao-label" htmlFor={`${id}-endereco`}>{label}{required ? ' *' : ''}</label>
      <div className="seletor-localizacao-busca">
        <input
          id={`${id}-endereco`}
          type="text"
          value={endereco}
          onChange={(evento) => editarEndereco(evento.target.value)}
          onKeyDown={(evento) => {
            if (evento.key === 'Enter') {
              evento.preventDefault();
              evento.stopPropagation();
              if (!atividade && !evento.nativeEvent.isComposing) void buscarEndereco();
            }
          }}
          placeholder="Rua, número, bairro e cidade ou CEP"
          autoComplete="street-address"
          enterKeyHint="search"
          disabled={disabled}
          required={required}
          aria-describedby={`${id}-ajuda${erro ? ` ${id}-erro` : ''}`}
          aria-invalid={Boolean(erro)}
        />
        <button type="button" onClick={() => void buscarEndereco()} disabled={disabled || atividade !== null}>
          {atividade === 'busca' ? <Loader2 className="seletor-localizacao-carregando" aria-hidden="true" /> : <Search aria-hidden="true" />}
          <span>Buscar</span>
        </button>
      </div>
      <div className="seletor-localizacao-acoes">
        <button type="button" onClick={() => void usarGps()} disabled={disabled || atividade !== null}>
          {atividade === 'gps' || atividade === 'endereco-gps' ? <Loader2 className="seletor-localizacao-carregando" aria-hidden="true" /> : <Crosshair aria-hidden="true" />}
          {atividade === 'gps' ? 'Obtendo localização…' : atividade === 'endereco-gps' ? 'Identificando endereço…' : 'Usar minha localização'}
        </button>
      </div>
      {pontoValido && (
        <label className="seletor-localizacao-manter-ponto">
          <input type="checkbox" checked={manterPonto} disabled={disabled} onChange={(evento) => mudarManterPonto(evento.target.checked)} />
          <span>Informar endereço mantendo este ponto</span>
        </label>
      )}
      <p id={`${id}-ajuda`} className="seletor-localizacao-ajuda">{manterPonto && pontoValido
        ? 'Preencha o endereço do ponto selecionado. Para mudar de local, use Buscar, GPS ou ajuste o mapa.'
        : 'Busque e escolha seu endereço, ou use o GPS. Confirme o número e o complemento.'}</p>
      {erro && <p id={`${id}-erro`} className="seletor-localizacao-erro" role="alert">{erro}</p>}
      {aviso && <p className="seletor-localizacao-aviso" role="status">{aviso}</p>}
      {opcoes.length > 0 && (
        <ul className="seletor-localizacao-opcoes" aria-label="Endereços encontrados">
          {opcoes.map((opcao, indice) => (
            <li key={`${opcao.latitude}-${opcao.longitude}-${indice}`}>
              <button type="button" disabled={disabled} onClick={() => escolherEndereco(opcao)}>
                <MapPin aria-hidden="true" />
                <span>{opcao.endereco || 'Endereço encontrado'}<small>Escolher este endereço</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {pontoValido && (
        <div className="seletor-localizacao-ponto">
          <p className="seletor-localizacao-confirmado"><CheckCircle2 aria-hidden="true" /> Ponto {pontoValido.origem === 'mapa' ? 'ajustado no mapa' : pontoValido.origem === 'gps' ? 'obtido pelo GPS' : 'selecionado'}</p>
          {precisaoDisponivel && <p className={aproximado ? 'seletor-localizacao-aproximado' : 'seletor-localizacao-ajuda'}>{aproximado ? 'Localização aproximada' : 'Precisão do aparelho'}: cerca de {Math.max(1, Math.round(precisao)).toLocaleString('pt-BR')} m.{aproximado ? ' Ajuste o marcador no local correto.' : ''}</p>}
          {pontoValido.origem === 'gps' && !precisaoDisponivel && <p className="seletor-localizacao-aproximado">Precisão não informada pelo aparelho. Confira o ponto e ajuste o marcador no local correto.</p>}
          <MapaSeguro>
            <Suspense fallback={<div className="seletor-localizacao-mapa-carregando" role="status">Carregando mapa…</div>}>
              <MapaLocalizacao latitude={pontoValido.latitude} longitude={pontoValido.longitude} onChange={ajustarMapa} disabled={disabled} />
            </Suspense>
          </MapaSeguro>
          <p className="seletor-localizacao-coordenadas">{pontoValido.latitude.toFixed(6)}, {pontoValido.longitude.toFixed(6)}</p>
        </div>
      )}
    </div>
  );
}
