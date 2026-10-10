/**
 * Arquivo: instaladores.ts
 * Responsabilidade: Lista os instaladores do Gestor para Windows, Linux e Android.
 */

export interface Instalador {
  id: 'windows' | 'linux' | 'android';
  nome: string;
  arquivo: string;
  href: string;
}

export const INSTALADORES: Instalador[] = [
  { id: 'windows', nome: 'Windows', arquivo: '.exe', href: '/downloads/gestor-windows' },
  { id: 'linux', nome: 'Linux', arquivo: '.AppImage', href: '/downloads/gestor-linux' },
  { id: 'android', nome: 'Android', arquivo: '.apk', href: '/downloads/gestor-android' },
];
