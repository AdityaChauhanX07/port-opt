import type { Variants } from 'framer-motion';

export const DURATION = {
  micro:  0.1,
  small:  0.15,
  medium: 0.2,
  large:  0.25,
} as const;

export const EASE = {
  default: [0.2, 0, 0, 1] as const,
  out:     [0.16, 1, 0.3, 1] as const,
  in:      [0.4, 0, 1, 1] as const,
} as const;

export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DURATION.small, ease: EASE.default } },
};

export const slideUp: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.medium, ease: EASE.default } },
};

export const scaleIn: Variants = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1, transition: { duration: DURATION.medium, ease: EASE.default } },
};

export const stagger = (delay = 0.03): Variants => ({
  animate: { transition: { staggerChildren: delay } },
});
