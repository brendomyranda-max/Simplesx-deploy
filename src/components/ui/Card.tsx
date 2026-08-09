import { motion } from 'framer-motion';

export function Card({
  children,
  className = '',
  hover = false,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}) {
  return (
    <motion.div
      whileHover={hover && onClick ? { y: -2 } : undefined}
      onClick={onClick}
      className={`card ${className}`}
    >
      {children}
    </motion.div>
  );
}
