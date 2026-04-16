import type { Variants } from 'framer-motion';

const EASE = [0.16, 1, 0.3, 1] as const;

export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.18, ease: EASE } },
};

export const slideUp: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE } },
};

export const stagger = (delay: number = 0.04): Variants => ({
  animate: { transition: { staggerChildren: delay } },
});
