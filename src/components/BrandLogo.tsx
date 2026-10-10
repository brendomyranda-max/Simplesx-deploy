/** Logotipo oficial da DoixP, reutilizado em todos os pontos de entrada. */

import type { ImgHTMLAttributes } from 'react';

type BrandLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>;

export function BrandLogo({ alt = 'DoixP', className = '', ...props }: BrandLogoProps) {
  return <img src="/brand/doixp-logo.png" alt={alt} className={`block object-contain ${className}`} {...props} />;
}
