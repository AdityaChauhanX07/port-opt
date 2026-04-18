'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/trpc/client';
import { usePortfolioStore } from '@/lib/stores/portfolio';
import type { PortfolioState } from '@/lib/stores/portfolio';
import { useRiskStore } from '@/lib/stores/risk';
import { slideUp, stagger } from '@/lib/motion';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QAPair {
  id: number;
  question: string;
  answer: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Minimal inline markdown renderer
// Handles: **bold**, *italic*, `code`, # headers, - bullets, numbered lists,
// blank-line-separated paragraphs.
// ---------------------------------------------------------------------------

function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const inlineFormat = (raw: string): React.ReactNode => {
    // Process **bold**, *italic*, `code` inline
    const parts: React.ReactNode[] = [];
    let remaining = raw;
    let k = 0;
    while (remaining.length > 0) {
      const boldIdx = remaining.indexOf('**');
      const italicIdx = remaining.indexOf('*');
      const codeIdx = remaining.indexOf('`');

      const raw_candidates: Array<[number, string]> = [
        [boldIdx >= 0 ? boldIdx : Infinity, '**'],
        [codeIdx >= 0 ? codeIdx : Infinity, '`'],
        [italicIdx >= 0 && (boldIdx === -1 || italicIdx < boldIdx) ? italicIdx : Infinity, '*'],
      ];
      const candidates: [number, string][] = raw_candidates.filter(
        (c): c is [number, string] => (c[0] as number) < Infinity
      );

      if (!candidates.length) {
        parts.push(remaining);
        break;
      }

      candidates.sort((a, b) => a[0] - b[0]);
      const [idx, marker] = candidates[0];

      if (idx > 0) {
        parts.push(remaining.slice(0, idx));
        remaining = remaining.slice(idx);
        continue;
      }

      const closeIdx = remaining.indexOf(marker, marker.length);
      if (closeIdx === -1) {
        parts.push(remaining[0]);
        remaining = remaining.slice(1);
        continue;
      }

      const inner = remaining.slice(marker.length, closeIdx);
      remaining = remaining.slice(closeIdx + marker.length);

      if (marker === '**') {
        parts.push(<strong key={k++}>{inner}</strong>);
      } else if (marker === '`') {
        parts.push(
          <code
            key={k++}
            className="mono text-[12px] bg-[var(--bg-hover)] px-1 py-0.5 rounded"
          >
            {inner}
          </code>
        );
      } else {
        parts.push(<em key={k++}>{inner}</em>);
      }
    }
    return <>{parts}</>;
  };

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const cls =
        level === 1
          ? 'text-[16px] font-semibold text-primary mt-4 mb-1'
          : level === 2
          ? 'text-[14px] font-semibold text-primary mt-3 mb-1'
          : 'text-[13px] font-medium text-secondary mt-2 mb-0.5';
      nodes.push(
        <p key={key++} className={cls}>
          {inlineFormat(content)}
        </p>
      );
      i++;
      continue;
    }

    // Unordered list block
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(lines[i].slice(2));
        i++;
      }
      nodes.push(
        <ul key={key++} className="list-disc pl-5 space-y-0.5 my-2">
          {items.map((item, j) => (
            <li key={j} className="text-[14px] text-primary leading-relaxed">
              {inlineFormat(item)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list block
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s/, ''));
        i++;
      }
      nodes.push(
        <ol key={key++} className="list-decimal pl-5 space-y-0.5 my-2">
          {items.map((item, j) => (
            <li key={j} className="text-[14px] text-primary leading-relaxed">
              {inlineFormat(item)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph: collect consecutive non-blank, non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3}|\s*[-*]\s|\d+\.\s)/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    nodes.push(
      <p key={key++} className="text-[14px] text-primary leading-relaxed my-1">
        {inlineFormat(paraLines.join(' '))}
      </p>
    );
  }

  return <div className="space-y-1">{nodes}</div>;
}

// ---------------------------------------------------------------------------
// Suggested questions
// ---------------------------------------------------------------------------

const SUGGESTED_QUESTIONS = [
  "What's driving my portfolio's risk?",
  'How would rising interest rates affect my allocation?',
  'Compare my Sharpe ratio to typical benchmarks',
  'What would happen if I removed the worst-performing asset?',
  "Explain my portfolio's behavior during COVID",
];

// ---------------------------------------------------------------------------
// Arrow send icon
// ---------------------------------------------------------------------------

function SendIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path
        d="M2 8L14 8M9 3L14 8L9 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpinnerIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className="animate-spin"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeOpacity="0.25"
      />
      <path
        d="M8 2a6 6 0 0 1 6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Algorithm display name
// ---------------------------------------------------------------------------

const ALGO_LABELS: Record<string, string> = {
  markowitz:        'Markowitz MVO',
  hrp:              'Hierarchical Risk Parity',
  risk_parity:      'Equal Risk Contribution',
  cvar:             'CVaR Minimisation',
  robust:           'Robust MVO',
  black_litterman:  'Black-Litterman',
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

let _nextId = 1;

export default function ResearchPage() {
  const store  = usePortfolioStore();
  const risk   = useRiskStore();

  const [conversation, setConversation] = useState<QAPair[]>([]);
  const [input,        setInput]        = useState('');
  const inputRef   = useRef<HTMLInputElement>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);

  // ── Check if API key is configured (server reports missing key as specific error)
  const [apiKeyMissing, setApiKeyMissing] = useState(false);

  // ── Portfolio readiness ───────────────────────────────────────────────────
  const hasPortfolio =
    store.tickers.length > 0 &&
    store.currentWeights !== null &&
    store.nAssets > 0;

  // ── Build context from stores ─────────────────────────────────────────────
  const context = useMemo(() => {
    if (!hasPortfolio || !store.currentWeights) return null;

    const weights = Array.from(store.currentWeights);
    const algoKey = store.activeAlgorithm;
    const cache   = store.algorithmCache[algoKey];

    // Metrics — prefer cached, fall back to zeros to avoid null context
    const annReturn = cache?.ret   ?? 0;
    const annVol    = cache?.vol   ?? 0;
    const sharpe    = cache?.sharpe ?? 0;

    // MaxDD from risk store MC params if available
    const maxDD = risk.mcParams ? 0 : 0; // not stored directly; we'll use 0 as placeholder

    const ctx: {
      tickers: string[];
      weights: number[];
      algorithm: string;
      metrics: { annReturn: number; annVol: number; sharpe: number; maxDD: number };
      regimes?: { current: string; bullPct: number; bearPct: number };
      stressResults?: { period: string; cumReturn: number; maxDD: number }[];
    } = {
      tickers:   store.tickers,
      weights,
      algorithm: ALGO_LABELS[algoKey] ?? algoKey,
      metrics:   { annReturn, annVol, sharpe, maxDD },
    };

    // Stress results from risk store
    if (risk.stressResults.length > 0) {
      ctx.stressResults = risk.stressResults.flatMap((sp) =>
        sp.series
          .filter((s) => s.label === 'Portfolio')
          .map((s) => ({
            period:    sp.name,
            cumReturn: s.cumRet,
            maxDD:     s.maxDD,
          }))
      );
    }

    return ctx;
  }, [hasPortfolio, store, risk.stressResults, risk.mcParams]);

  // ── tRPC mutation ─────────────────────────────────────────────────────────
  const mutation = api.ai.analyze.useMutation({
    onSuccess: (data, variables) => {
      setConversation((prev) =>
        prev.map((pair) =>
          pair.question === variables.question && pair.answer === null
            ? { ...pair, answer: data.answer }
            : pair
        )
      );
    },
    onError: (err, variables) => {
      const msg = err.message ?? 'Unknown error';
      if (msg.includes('ANTHROPIC_API_KEY_NOT_SET')) {
        setApiKeyMissing(true);
      }
      setConversation((prev) =>
        prev.map((pair) =>
          pair.question === variables.question && pair.answer === null
            ? { ...pair, error: msg.includes('ANTHROPIC_API_KEY_NOT_SET')
                ? 'Configure ANTHROPIC_API_KEY in .env.local to enable AI analysis.'
                : msg.includes('rate_limit') || msg.includes('429')
                ? 'Too many requests. Wait a moment.'
                : msg }
            : pair
        )
      );
    },
  });

  // ── Submit question ───────────────────────────────────────────────────────
  const submit = useCallback(
    (question: string) => {
      if (!question.trim() || !context || mutation.isPending) return;

      const pair: QAPair = {
        id:       _nextId++,
        question: question.trim(),
        answer:   null,
        error:    null,
      };

      setConversation((prev) => {
        const next = [...prev, pair];
        return next.length > 20 ? next.slice(next.length - 20) : next;
      });
      setInput('');

      mutation.mutate({ question: question.trim(), context });
    },
    [context, mutation]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  };

  // ── Retry ─────────────────────────────────────────────────────────────────
  const retry = useCallback(
    (pair: QAPair) => {
      if (!context) return;
      setConversation((prev) =>
        prev.map((p) => (p.id === pair.id ? { ...p, error: null, answer: null } : p))
      );
      mutation.mutate({ question: pair.question, context });
    },
    [context, mutation]
  );

  // ── Scroll to bottom on new messages ─────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation]);

  // ── Pending pair is the last one with answer === null and no error ────────
  const pendingId = useMemo(() => {
    const last = [...conversation].reverse().find((p) => p.answer === null && p.error === null);
    return last?.id ?? null;
  }, [conversation]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Scrollable area */}
      <div className="flex-1 overflow-y-auto">
        <motion.div
          className="mx-auto max-w-[720px] px-6 py-8 flex flex-col"
          style={{ gap: 'var(--space-8)' }}
          initial="initial"
          animate="animate"
          variants={stagger(0.04)}
        >
          {/* ── Title ──────────────────────────────────────────────────── */}
          <motion.div variants={slideUp}>
            <h1 className="text-[20px] font-semibold text-primary mb-1">Research</h1>
            <p className="text-[13px] text-tertiary">
              Ask natural language questions about your portfolio.
            </p>
          </motion.div>

          {/* ── Context card ───────────────────────────────────────────── */}
          <motion.div variants={slideUp}>
            {!hasPortfolio ? (
              <div className="rounded-lg border border-[var(--border)] bg-subtle px-5 py-4">
                <p className="text-[13px] text-secondary">
                  No portfolio loaded.{' '}
                  <Link
                    href="/optimize"
                    className="text-accent hover:text-accent-hover transition-colors duration-[var(--duration)]"
                  >
                    Run an optimisation on the Optimize page first →
                  </Link>
                </p>
              </div>
            ) : (
              <ContextCard store={store} />
            )}
          </motion.div>

          {/* ── API key missing notice ──────────────────────────────────── */}
          {apiKeyMissing && (
            <motion.div
              variants={slideUp}
              className="rounded-lg border border-[var(--border-strong)] bg-[rgba(248,81,73,0.06)] px-5 py-3"
            >
              <p className="text-[13px] text-loss">
                Configure <code className="mono text-[12px]">ANTHROPIC_API_KEY</code> in{' '}
                <code className="mono text-[12px]">apps/web/.env.local</code> to enable AI
                analysis.
              </p>
            </motion.div>
          )}

          {/* ── Conversation ───────────────────────────────────────────── */}
          {conversation.length === 0 && hasPortfolio && !apiKeyMissing ? (
            <motion.div variants={slideUp}>
              <p className="text-[11px] uppercase tracking-[0.06em] text-tertiary mb-3">
                Suggested questions
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => submit(q)}
                    disabled={mutation.isPending}
                    className="rounded-full border border-[var(--border)] bg-subtle px-3 py-1.5 text-[12px] text-secondary hover:bg-[var(--bg-hover)] hover:text-primary hover:border-[var(--border-strong)] transition-colors duration-[var(--duration)] disabled:opacity-40"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <div className="flex flex-col gap-8">
              <AnimatePresence initial={false}>
                {conversation.map((pair) => (
                  <motion.div
                    key={pair.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className="flex flex-col gap-3"
                  >
                    {/* Question bubble — right-aligned */}
                    <div className="flex justify-end">
                      <div className="max-w-[70%] rounded-2xl rounded-tr-sm bg-subtle px-4 py-2.5">
                        <p className="text-[13px] text-primary leading-relaxed">
                          {pair.question}
                        </p>
                      </div>
                    </div>

                    {/* Answer / loading / error — left */}
                    <div className="flex flex-col gap-2">
                      {pair.answer !== null ? (
                        <MarkdownText text={pair.answer} />
                      ) : pair.error !== null ? (
                        <div className="flex items-start gap-3">
                          <p className="text-[13px] text-loss flex-1">{pair.error}</p>
                          {!pair.error.includes('Configure') && (
                            <button
                              onClick={() => retry(pair)}
                              className="shrink-0 text-[12px] text-accent hover:text-accent-hover transition-colors duration-[var(--duration)]"
                            >
                              Retry
                            </button>
                          )}
                        </div>
                      ) : (
                        /* Loading skeleton */
                        <div className="flex items-center gap-2 text-tertiary">
                          <SpinnerIcon size={14} />
                          <span className="text-[13px]">Analysing…</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}

          <div ref={bottomRef} />
        </motion.div>
      </div>

      {/* ── Fixed input bar at bottom ─────────────────────────────────── */}
      {hasPortfolio && (
        <div className="shrink-0 hairline-t bg-bg px-6 py-4">
          <div className="mx-auto max-w-[720px]">
            <div className="relative flex items-center gap-2 rounded-lg bg-inset border border-transparent focus-within:border-[var(--border-focus)] transition-colors duration-[var(--duration)]">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={mutation.isPending}
                placeholder="Ask about your portfolio…"
                className="flex-1 h-10 bg-transparent px-4 text-[13px] text-primary placeholder:text-tertiary outline-none disabled:opacity-50"
                autoFocus
              />

              {/* Spinner while loading */}
              {mutation.isPending && (
                <div className="pr-3 text-tertiary">
                  <SpinnerIcon size={14} />
                </div>
              )}

              {/* Send button — only when there's text and not loading */}
              {input.trim() && !mutation.isPending && (
                <button
                  onClick={() => submit(input)}
                  className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-white hover:bg-accent-hover transition-colors duration-[var(--duration)]"
                  aria-label="Send"
                >
                  <SendIcon size={13} />
                </button>
              )}
            </div>

            <p className="mt-1.5 text-[11px] text-tertiary text-center">
              Powered by Claude · Press Enter to send
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Context card sub-component
// ---------------------------------------------------------------------------

function ContextCard({ store }: { store: PortfolioState }) {
  const weights = store.currentWeights ? Array.from(store.currentWeights) : [];
  const cache   = store.algorithmCache[store.activeAlgorithm];

  const topHoldings = store.tickers
    .map((t, i) => ({ ticker: t, w: weights[i] ?? 0 }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 5);

  const algoLabel = ALGO_LABELS[store.activeAlgorithm] ?? store.activeAlgorithm;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-subtle px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] uppercase tracking-[0.06em] text-tertiary">
          Claude knows about this portfolio
        </p>
        <span className="text-[11px] text-tertiary mono">{algoLabel}</span>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {/* Top holdings */}
        <div className="flex flex-wrap gap-2">
          {topHoldings.map(({ ticker, w }) => (
            <span
              key={ticker}
              className="rounded-md bg-[var(--bg-hover)] px-2 py-0.5 text-[12px] mono text-secondary"
            >
              {ticker}{' '}
              <span className="text-primary font-medium">{(w * 100).toFixed(1)}%</span>
            </span>
          ))}
          {store.tickers.length > 5 && (
            <span className="text-[12px] text-tertiary self-center">
              +{store.tickers.length - 5} more
            </span>
          )}
        </div>

        {/* Key metrics */}
        {cache && (
          <div className="flex gap-4 ml-auto">
            <Chip label="Return" value={`${(cache.ret * 100).toFixed(1)}%`} />
            <Chip label="Vol" value={`${(cache.vol * 100).toFixed(1)}%`} />
            <Chip label="Sharpe" value={cache.sharpe.toFixed(2)} />
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-[12px] text-tertiary">
      {label}{' '}
      <span className="mono text-primary font-medium">{value}</span>
    </span>
  );
}
