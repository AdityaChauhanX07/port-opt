import { router } from '../trpc';
import { aiRouter } from './ai';
import { dataRouter } from './data';

export const appRouter = router({
  ai: aiRouter,
  data: dataRouter,
});

export type AppRouter = typeof appRouter;
