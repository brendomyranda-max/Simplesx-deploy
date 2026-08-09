import type { Bobina } from './print'
import { gestorApi } from './api'

/**
 * Ponte com o "Gestor de Impressoras CUPS" (servidor HTTP local).
 * Se ele não estiver rodando, o app usa window.print() como fallback.
 */
export const CUPS_SERVER = 'http://127.0.0.1:8410'

const KEY_80 = 'simplesx_printer_80'
const KEY_58 = 'simplesx_printer_58'
const KEY_DIRECT = 'simplesx_direct_print'

export function getPrinterForWidth(width: Bobina): string {
  const k = width === '58' ? KEY_58 : KEY_80
  return localStorage.getItem(k) || (width === '58' ? 'HaoYin58' : 'Diebold80')
}

export function setPrinterForWidth(width: Bobina, name: string) {
  localStorage.setItem(width === '58' ? KEY_58 : KEY_80, name)
}

export function getDirectPrint(): boolean {
  return localStorage.getItem(KEY_DIRECT) !== 'false'
}

export function setDirectPrint(v: boolean) {
  localStorage.setItem(KEY_DIRECT, v ? 'true' : 'false')
}

const KEY_GESTOR = 'simplesx_gestor_token'

export function getGestorToken(): string {
  return localStorage.getItem(KEY_GESTOR) || ''
}

export function setGestorToken(t: string) {
  if (t) localStorage.setItem(KEY_GESTOR, t)
  else localStorage.removeItem(KEY_GESTOR)
}

/**
 * Envia a impressão pela fila do deploy (gestor local conectado via internet).
 * O app gera o conteúdo e o servidor entrega ao gestor, que imprime via CUPS.
 * Retorna false se não houver gestor configurado / falhar (quem chama cai
 * para a impressão local).
 */
export async function enviarViaDeploy(
  el: HTMLElement | null | undefined,
  width: Bobina = '80',
): Promise<boolean> {
  try {
    const html = el?.innerHTML?.trim()
    if (!html) return false
    const res = await gestorApi.enviar({
      tipo: 'html',
      conteudo: html,
      impressora: getPrinterForWidth(width) || undefined,
      largura_mm: width === '58' ? 58 : 80,
      cortar: true,
      alimentar: width === '58' ? 3 : 0,
      gestor_token: getGestorToken() || undefined,
    })
    return !!res?.ok
  } catch {
    return false
  }
}

export interface CupsPrinter {
  name: string
  state: string
  enabled: boolean
  accepting: boolean
  isDefault: boolean
  raw: boolean
  deviceUri: string
}

export async function cupsHealth(): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 2500)
    const res = await fetch(CUPS_SERVER + '/health', { signal: ctrl.signal })
    clearTimeout(t)
    return res.ok
  } catch {
    return false
  }
}

export async function cupsPrinters(): Promise<CupsPrinter[]> {
  try {
    const res = await fetch(CUPS_SERVER + '/printers')
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data?.printers) ? data.printers : []
  } catch {
    return []
  }
}

export interface CupsPrintPayload {
  printer?: string
  title?: string
  html?: string
  text?: string
  copies?: number
  cut?: boolean
  feed?: number
}

export async function sendCupsPrint(p: CupsPrintPayload): Promise<{ ok: boolean; error?: string; cupsJobId?: string }> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    const res = await fetch(CUPS_SERVER + '/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    const data = await res.json().catch(() => ({}))
    return { ok: !!data.ok, error: data.error, cupsJobId: data.cupsJobId }
  } catch {
    return { ok: false, error: 'Servidor CUPS indisponível' }
  }
}
