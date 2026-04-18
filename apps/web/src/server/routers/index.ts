import { router } from '../trpc';
import { aiRouter } from './ai';
import { dataRouter } from './data';
import { userRouter } from './user';

export const appRouter = router({
  ai: aiRouter,
  data: dataRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
