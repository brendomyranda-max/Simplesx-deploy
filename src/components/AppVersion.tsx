import React from 'react';
import { version } from '../../package.json';

export function AppVersion({ className = '' }: { className?: string }) {
  return <p className={className}>DoixP {version} · Pré-lançamento</p>;
}
