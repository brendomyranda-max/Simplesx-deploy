import { motion } from 'framer-motion';

export function IconButton({
  icon,
  label,
  onClick,
  variant = 'ghost',
  className = '',
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  variant?: 'ghost' | 'danger' | 'primary';
  className?: string;
  disabled?: boolean;
}) {
  const cls =
    variant === 'danger'
      ? 'hover:bg-red-50 text-red-600'
      : variant === 'primary'
        ? 'hover:bg-brand-50 text-brand-600'
        : 'hover:bg-slate-100 text-slate-500';
  return (
    <motion.button
      whileTap={{ scale: 0.88 }}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${cls} ${className}`}
    >
      {icon}
    </motion.button>
  );
}
