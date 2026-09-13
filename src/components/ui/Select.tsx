/**
 * Arquivo: Select.tsx
 * Responsabilidade: Componente visual reutilizável Select.tsx usado para manter a interface consistente.
 */

import React from 'react';

export function Select({
  className = '',
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`input ${className}`} {...rest}>
      {children}
    </select>
  );
}
