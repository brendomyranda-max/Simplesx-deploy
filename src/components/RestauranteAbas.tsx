/**
 * Separa Mesas, Delivery e Cozinha dentro do restaurante.
 */

import { useNavigate } from 'react-router-dom';
import { Tabs } from '@/components/ui';

export type SecaoRestaurante = 'mesas' | 'delivery' | 'cozinha';

const DESTINOS: Record<SecaoRestaurante, string> = {
  mesas: '/restaurante',
  delivery: '/restaurante/delivery',
  cozinha: '/restaurante/cozinha',
};

export function RestauranteAbas({ atual }: { atual: SecaoRestaurante }) {
  const navigate = useNavigate();
  return (
    <Tabs<SecaoRestaurante>
      tabs={[
        { value: 'mesas', label: 'Mesas' },
        { value: 'delivery', label: 'Delivery' },
        { value: 'cozinha', label: 'Cozinha' },
      ]}
      value={atual}
      onChange={(secao) => {
        if (secao !== atual) navigate(DESTINOS[secao]);
      }}
    />
  );
}
