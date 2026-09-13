/**
 * Arquivo: Textarea.tsx
 * Responsabilidade: Componente visual reutilizável Textarea.tsx usado para manter a interface consistente.
 */

import React from 'react';

export function Textarea({ className = '', ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`input ${className}`} {...rest} />;
}
