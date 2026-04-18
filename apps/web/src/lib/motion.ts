import type { Variants } from 'framer-motion';

// Linear-grade motion constants — fast and functional, never decorative
export const DURATION = {
  instant: 0.08,  // hover states, active states
  fast:    0.12,  // tab switches, small reveals
  normal:  0.15,  // card reveals, section transitions
  slow:    0.20,  // page transitions
} as const;

export const EASE = {
  out:    [0.16, 1, 0.3, 1] as const,  // primary — fast in, gentle out
  inOut:  [0.4, 0, 0.2, 1]  as const,  // symmetric transitions
  linear: [0, 0, 1, 1]      as const,  // progress bars only
} as const;

export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: DURATION.fast, ease: EASE.out } },
};

export const slideUp: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: DURATION.normal, ease: EASE.out } },
};

export const scaleIn: Variants = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1, transition: { duration: DURATION.normal, ease: EASE.out } },
};

// Very fast stagger — barely perceptible, just enough to feel intentional
export const stagger = (delay: number = 0.03): Variants => ({
  animate: { transition: { staggerChildren: delay } },
});
