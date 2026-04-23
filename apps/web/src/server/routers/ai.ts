import Groq from 'groq-sdk';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || '',
});

const ContextSchema = z.object({
  tickers: z.array(z.string()),
  weights: z.array(z.number()),
  algorithm: z.string(),
  metrics: z.object({
    annReturn: z.number(),
    annVol: z.number(),
    sharpe: z.number(),
    maxDD: z.number(),
  }),
  regimes: z
    .object({
      current: z.string(),
      bullPct: z.number(),
      bearPct: z.number(),
    })
    .optional(),
  stressResults: z
    .array(
      z.object({
        period: z.string(),
        cumReturn: z.number(),
        maxDD: z.number(),
      })
    )
    .optional(),
});

export const aiRouter = router({
  analyze: publicProcedure
    .input(
      z.object({
        question: z.string().min(1).max(2000),
        context: ContextSchema,
      })
    )
    .mutation(async ({ input }) => {
      if (!process.env.GROQ_API_KEY) {
        throw new Error('GROQ_API_KEY_NOT_SET');
      }

      const { question, context } = input;

      const allocationStr = context.tickers
        .map((t, i) => `${t}: ${((context.weights[i] ?? 0) * 100).toFixed(1)}%`)
        .join(', ');

      const systemPrompt = `You are a senior quantitative portfolio analyst with deep expertise in portfolio construction, risk management, and factor investing.

The user has built a portfolio using the **${context.algorithm}** algorithm with these allocations:
${allocationStr}

Portfolio metrics:
- Annualized return: ${(context.metrics.annReturn * 100).toFixed(2)}%
- Annualized volatility: ${(context.metrics.annVol * 100).toFixed(2)}%
- Sharpe ratio: ${context.metrics.sharpe.toFixed(2)}
- Maximum drawdown: ${(context.metrics.maxDD * 100).toFixed(2)}%
${
  context.regimes
    ? `\nCurrent market regime: **${context.regimes.current}** (Bull ${(context.regimes.bullPct * 100).toFixed(0)}% / Bear ${(context.regimes.bearPct * 100).toFixed(0)}% of historical observations)`
    : ''
}
${
  context.stressResults?.length
    ? `\nStress test results:\n${context.stressResults
        .map(
          (s) =>
            `- ${s.period}: ${(s.cumReturn * 100).toFixed(1)}% cumulative return, ${(s.maxDD * 100).toFixed(1)}% max drawdown`
        )
        .join('\n')}`
    : ''
}

Instructions:
- Be specific and quantitative — reference the actual portfolio numbers above.
- Be direct and analytical. No disclaimers about "not financial advice".
- Keep responses concise: 2–4 paragraphs maximum.
- Use **bold** for key numbers and conclusions.
- If the user asks something that cannot be determined from the data provided, say so clearly and explain what additional data would be needed.`;

      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        max_tokens: 1000,
        temperature: 0.3,
      });

      const text = completion.choices[0]?.message?.content ?? 'No response generated.';
      return { answer: text };
    }),
});
