/**
 * Arquivo: pda-plataforma.test.js
 * Responsabilidade: Garante que o PDA reconhece Windows, Linux e Android.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { detectarPlataforma, navegadorCompativel, passosInstalacao } from '../src/lib/pda-plataforma.js';

const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const WINDOWS_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0';
const LINUX_CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const LINUX_FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

test('reconhece Windows, Linux e Android sem confundir o Android com Linux', () => {
  assert.equal(detectarPlataforma(WINDOWS_CHROME), 'windows');
  assert.equal(detectarPlataforma(WINDOWS_EDGE), 'windows');
  assert.equal(detectarPlataforma(LINUX_CHROME), 'linux');
  assert.equal(detectarPlataforma(ANDROID_CHROME), 'android');
});

test('aceita Chrome e Edge e recusa Firefox para a instalação direta', () => {
  assert.equal(navegadorCompativel(WINDOWS_CHROME), true);
  assert.equal(navegadorCompativel(WINDOWS_EDGE), true);
  assert.equal(navegadorCompativel(LINUX_CHROME), true);
  assert.equal(navegadorCompativel(ANDROID_CHROME), true);
  assert.equal(navegadorCompativel(LINUX_FIREFOX), false);
});

test('explica a instalação em tela cheia nos três sistemas', () => {
  assert.match(passosInstalacao('windows', WINDOWS_CHROME).join(' '), /tela cheia/);
  assert.match(passosInstalacao('windows', WINDOWS_EDGE).join(' '), /Edge/);
  assert.match(passosInstalacao('linux', LINUX_CHROME).join(' '), /Linux/);
  assert.match(passosInstalacao('android', ANDROID_CHROME).join(' '), /tela cheia/);
});
