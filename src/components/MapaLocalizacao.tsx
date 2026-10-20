/** Leaflet fica em um chunk separado, carregado somente após selecionar um ponto. */
import { useEffect, useId, useRef } from 'react';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

type Props = {
  latitude: number;
  longitude: number;
  onChange: (ponto: { latitude: number; longitude: number }) => void;
  disabled?: boolean;
};

// Tiles públicos: somente a área visível, cache HTTP normal e atribuição permanente.
// Uma instalação com maior tráfego pode substituir esta URL por seu provedor de tiles.
const URL_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export default function MapaLocalizacao({ latitude, longitude, onChange, disabled = false }: Props) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const marcador = useRef<L.Marker | null>(null);
  const atual = useRef({ latitude, longitude, onChange, disabled });
  atual.current = { latitude, longitude, onChange, disabled };

  useEffect(() => {
    const elemento = container.current;
    if (!elemento) return;
    const instancia = L.map(elemento, {
      center: [atual.current.latitude, atual.current.longitude],
      zoom: 17,
      minZoom: 3,
      maxZoom: 19,
      scrollWheelZoom: false,
      attributionControl: false,
    });
    mapa.current = instancia;
    L.control.attribution({ prefix: false }).addTo(instancia);
    L.tileLayer(URL_TILES, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      updateWhenIdle: true,
      keepBuffer: 1,
    }).addTo(instancia);
    instancia.zoomControl.setPosition('topright');
    const icone = L.divIcon({
      className: 'localizacao-mapa-marcador',
      html: '<span class="localizacao-mapa-pino" aria-hidden="true"></span>',
      iconSize: [32, 42],
      iconAnchor: [16, 40],
    });
    const ponto = L.marker([atual.current.latitude, atual.current.longitude], {
      icon: icone,
      draggable: !atual.current.disabled,
      keyboard: true,
      autoPan: true,
      title: 'Ponto selecionado. Arraste ou use as setas do teclado para ajustar.',
      alt: 'Ponto selecionado',
    }).addTo(instancia);
    marcador.current = ponto;

    const informar = (coordenada: L.LatLng) => {
      if (atual.current.disabled) return;
      const longitudeNormalizada = ((coordenada.lng + 180) % 360 + 360) % 360 - 180;
      atual.current.onChange({ latitude: Math.max(-90, Math.min(90, coordenada.lat)), longitude: longitudeNormalizada });
    };
    const clicar = (evento: L.LeafletMouseEvent) => informar(evento.latlng);
    const arrastar = () => informar(ponto.getLatLng());
    const moverPorTeclado = (evento: KeyboardEvent) => {
      const teclas = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (!teclas.includes(evento.key) || atual.current.disabled) return;
      evento.preventDefault();
      evento.stopPropagation();
      const coordenada = ponto.getLatLng();
      const passoLatitude = (evento.shiftKey ? 25 : 5) / 111320;
      const passoLongitude = passoLatitude / Math.max(0.01, Math.cos(coordenada.lat * Math.PI / 180));
      informar(L.latLng(
        coordenada.lat + (evento.key === 'ArrowUp' ? passoLatitude : evento.key === 'ArrowDown' ? -passoLatitude : 0),
        coordenada.lng + (evento.key === 'ArrowRight' ? passoLongitude : evento.key === 'ArrowLeft' ? -passoLongitude : 0),
      ));
    };
    const alvo = ponto.getElement();
    alvo?.setAttribute('role', 'button');
    alvo?.setAttribute('aria-label', 'Ponto selecionado. Use as setas para mover cinco metros, ou Shift e setas para mover vinte e cinco metros.');
    alvo?.setAttribute('aria-describedby', `${id}-ajuda`);
    alvo?.addEventListener('keydown', moverPorTeclado);
    instancia.on('click', clicar);
    ponto.on('dragend', arrastar);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => instancia.invalidateSize({ pan: false }));
    resize?.observe(elemento);
    const frame = requestAnimationFrame(() => instancia.invalidateSize({ pan: false }));

    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      alvo?.removeEventListener('keydown', moverPorTeclado);
      ponto.off('dragend', arrastar);
      instancia.off('click', clicar);
      instancia.remove();
      if (mapa.current === instancia) mapa.current = null;
      if (marcador.current === ponto) marcador.current = null;
    };
  }, [id]);

  useEffect(() => {
    const instancia = mapa.current;
    const ponto = marcador.current;
    if (!instancia || !ponto) return;
    ponto.setLatLng([latitude, longitude]);
    if (disabled) ponto.dragging?.disable();
    else ponto.dragging?.enable();
    if (!instancia.getBounds().pad(-0.15).contains([latitude, longitude])) instancia.panTo([latitude, longitude], { animate: false });
    ponto.getElement()?.setAttribute('aria-disabled', String(disabled));
  }, [latitude, longitude, disabled]);

  return (
    <div className="localizacao-mapa-area">
      <div ref={container} className="localizacao-mapa" role="region" aria-label="Mapa com o ponto selecionado" />
      <p id={`${id}-ajuda`} className="seletor-localizacao-ajuda">{disabled ? 'Localização selecionada no mapa.' : 'Toque no mapa ou arraste o marcador até a entrada. Pelo teclado, selecione o marcador e use as setas.'}</p>
    </div>
  );
}
