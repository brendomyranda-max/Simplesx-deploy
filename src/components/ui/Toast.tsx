import React, { createContext, useContext, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  msg: string;
}

const ToastCtx = createContext<(type: Toast['type'], msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (type: Toast['type'], msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, type, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  };

  const value = useMemo(() => push, []);
  const icons = {
    success: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
    error: <AlertTriangle className="h-5 w-5 text-red-500" />,
    info: <Info className="h-5 w-5 text-brand-500" />,
  };

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 60 }}
              className="pointer-events-auto flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lift"
            >
              {icons[t.type]}
              <p className="text-sm font-medium text-slate-700">{t.msg}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
