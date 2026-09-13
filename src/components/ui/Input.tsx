/**
 * Arquivo: Input.tsx
 * Responsabilidade: Componente visual reutilizável Input.tsx usado para manter a interface consistente.
 */

import React from 'react';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = '', ...rest }, ref) {
    return <input ref={ref} className={`input ${className}`} {...rest} />;
  }
);
