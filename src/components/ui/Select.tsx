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
