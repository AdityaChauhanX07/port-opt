import { router } from '../trpc';
import { dataRouter } from './data';

export const appRouter = router({
  data: dataRouter,
});

export type AppRouter = typeof appRouter;
