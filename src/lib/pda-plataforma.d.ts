export type PlataformaPda = 'windows' | 'linux' | 'android' | 'ios' | 'outro';

export const SISTEMAS_PDA: ReadonlyArray<{
  id: 'windows' | 'linux' | 'android';
  nome: string;
  onde: string;
}>;

export function detectarPlataforma(ua: string): PlataformaPda;
export function navegadorCompativel(ua: string): boolean;
export function passosInstalacao(plataforma: PlataformaPda | string, ua: string): string[];
