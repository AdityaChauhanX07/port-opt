import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import {
  listPortfolios,
  savePortfolio,
  deletePortfolio,
  getPortfolio,
} from '@/lib/storage';

const ConstraintsSchema = z.object({
  longOnly: z.boolean(),
  lb: z.number(),
  ub: z.number(),
  rf: z.number(),
});

const MetricsSchema = z.object({
  annReturn: z.number(),
  annVol: z.number(),
  sharpe: z.number(),
  maxDD: z.number(),
});

const SaveInputSchema = z.object({
  name: z.string().min(1).max(80),
  tickers: z.array(z.string()),
  weights: z.array(z.number()),
  algorithm: z.string(),
  constraints: ConstraintsSchema,
  metrics: MetricsSchema,
});

export const userRouter = router({
  listPortfolios: protectedProcedure.query(async ({ ctx }) => {
    return listPortfolios(ctx.userId);
  }),

  savePortfolio: protectedProcedure
    .input(SaveInputSchema)
    .mutation(async ({ ctx, input }) => {
      return savePortfolio(ctx.userId, input);
    }),

  deletePortfolio: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return deletePortfolio(ctx.userId, input.id);
    }),

  loadPortfolio: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return getPortfolio(ctx.userId, input.id);
    }),
});
