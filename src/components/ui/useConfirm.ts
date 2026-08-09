import { useToast } from './Toast';

export function useConfirm() {
  const toast = useToast();
  return (title: string, msg: string, onOk: () => Promise<void> | void) => {
    if (window.confirm(`${title}\n\n${msg}`)) {
      Promise.resolve(onOk()).catch((e) => toast('error', e?.error || e?.message || 'Erro ao executar'));
    }
  };
}
