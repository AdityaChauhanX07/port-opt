'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUp } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Card } from '@portopt/ui';
import { api } from '@/lib/trpc/client';
import { usePortfolioStore } from '@/lib/stores/portfolio';
import type { PortfolioState } from '@/lib/stores/portfolio';
import { useRiskStore } from '@/lib/stores/risk';

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
// Inline markdown renderer (kept from previous — handles bold, italic, code,
// headings, lists, and paragraphs without an external dep)
// ---------------------------------------------------------------------------

function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const inline = (raw: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let rem = raw;
    let k = 0;
    while (rem.length > 0) {
      const b = rem.indexOf('**');
      const c = rem.indexOf('`');
      const e = rem.indexOf('*');
      const cands: [number, string][] = ([
        [b >= 0 ? b : Infinity, '**'],
        [c >= 0 ? c : Infinity, '`'],
        [e >= 0 && (b === -1 || e < b) ? e : Infinity, '*'],
      ] as [number, string][]).filter(([n]) => n < Infinity).sort((a, b2) => a[0] - b2[0]);
      if (!cands.length) { parts.push(rem); break; }
      const [idx, marker] = cands[0]!;
      if (idx > 0) { parts.push(rem.slice(0, idx)); rem = rem.slice(idx); continue; }
      const close = rem.indexOf(marker, marker.length);
      if (close === -1) { parts.push(rem[0]); rem = rem.slice(1); continue; }
      const inner = rem.slice(marker.length, close);
      rem = rem.slice(close + marker.length);
      if (marker === '**') parts.push(<strong key={k++}>{inner}</strong>);
      else if (marker === '`') parts.push(<code key={k++} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--surface-elevated)', padding: '1px 5px', borderRadius: 3 }}>{inner}</code>);
      else parts.push(<em key={k++}>{inner}</em>);
    }
    return <>{parts}</>;
  };

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const hm = line.match(/^(#{1,3})\s+(.*)/);
    if (hm) {
      const lvl = hm[1]!.length;
      const cls = lvl === 1 ? { fontSize: 16, fontWeight: 600, marginTop: 16, marginBottom: 4 } : lvl === 2 ? { fontSize: 14, fontWeight: 600, marginTop: 12, marginBottom: 2 } : { fontSize: 13, fontWeight: 500, marginTop: 8 };
      nodes.push(<p key={key++} style={{ ...cls, color: 'var(--text-primary)' }}>{inline(hm[2]!)}</p>);
      i++; continue;
    }
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i]!)) { items.push(lines[i]!.slice(2)); i++; }
      nodes.push(<ul key={key++} style={{ listStyleType: 'disc', paddingLeft: 20, margin: '6px 0' }}>{items.map((item, j) => <li key={j} style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6, marginBottom: 2 }}>{inline(item)}</li>)}</ul>);
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) { items.push(lines[i]!.replace(/^\d+\.\s/, '')); i++; }
      nodes.push(<ol key={key++} style={{ listStyleType: 'decimal', paddingLeft: 20, margin: '6px 0' }}>{items.map((item, j) => <li key={j} style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6, marginBottom: 2 }}>{inline(item)}</li>)}</ol>);
      continue;
    }
    const paras: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,3}|\s*[-*]\s|\d+\.\s)/.test(lines[i]!)) { paras.push(lines[i]!); i++; }
    nodes.push(<p key={key++} style={{ fontSize: 15, color: 'var(--text-primary)', lineHeight: 1.7, margin: '4px 0' }}>{inline(paras.join(' '))}</p>);
  }
  return <div>{nodes}</div>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALGO_LABELS: Record<string, string> = {
  markowitz:       'Markowitz MVO',
  hrp:             'HRP',
  risk_parity:     'Risk Parity',
  cvar:            'CVaR',
  robust:          'Robust MVO',
  black_litterman: 'Black-Litterman',
};

const SUGGESTION_GROUPS = [
  {
    category: 'Risk & Attribution',
    questions: [
      "What's driving my portfolio's risk?",
      'Which asset contributes most to drawdowns?',
    ],
  },
  {
    category: 'Scenarios',
    questions: [
      'How would rising interest rates affect my allocation?',
      'What happens if equity volatility doubles?',
    ],
  },
  {
    category: 'Comparison',
    questions: [
      'Compare my Sharpe ratio to a 60/40 portfolio',
      'How does my allocation differ from Risk Parity?',
    ],
  },
  {
    category: 'Historical',
    questions: [
      'How did the portfolio behave during COVID?',
      'What was my worst quarter and why?',
    ],
  },
] as const;

let _nextId = 1;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SuggestionRow({ question, onSubmit, disabled }: { question: string; onSubmit: (q: string) => void; disabled: boolean }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      onClick={() => onSubmit(question)}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        textAlign: 'left',
        background: hovered ? 'var(--bg-inset)' : 'transparent',
        border: 'none',
        borderRadius: 'var(--radius)',
        padding: '12px 0',
        cursor: 'pointer',
        transition: `background var(--duration-micro) var(--ease)`,
      }}
    >
      <span style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5 }}>{question}</span>
      <span style={{
        fontSize: 14,
        color: hovered ? 'var(--text-secondary)' : 'var(--text-tertiary)',
        flexShrink: 0,
        marginLeft: 12,
        transition: `color var(--duration-micro) var(--ease)`,
      }}>→</span>
    </button>
  );
}

function Spinner() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" className="animate-spin" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ContextCard({ store }: { store: PortfolioState }) {
  const weights = store.currentWeights ? Array.from(store.currentWeights) : [];
  const cache   = store.algorithmCache[store.activeAlgorithm];
  const algoLabel = ALGO_LABELS[store.activeAlgorithm] ?? store.activeAlgorithm;

  const sortedAssets = store.tickers
    .map((t, i) => ({ ticker: t, w: weights[i] ?? 0 }))
    .sort((a, b) => b.w - a.w);

  const showAll = sortedAssets.length <= 8;
  const displayed = showAll ? sortedAssets : sortedAssets.slice(0, 6);
  const overflow  = showAll ? 0 : sortedAssets.length - 6;

  const periodLabel = store.frequency === 'weekly' ? 'weeks' : store.frequency === 'monthly' ? 'months' : 'trading days';
  const contextLine = store.nPeriods > 0
    ? `Period: ${store.dateRange.start.slice(0, 7)} → ${store.dateRange.end.slice(0, 7)} · ${store.nPeriods.toLocaleString()} ${periodLabel}${cache ? ` · Sharpe ${cache.sharpe.toFixed(3)}` : ''}`
    : null;

  return (
    <Card padding="md">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Portfolio Context
        </p>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>{algoLabel}</span>
      </div>

      {/* Ticker pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: contextLine ? 10 : 0 }}>
        {displayed.map(({ ticker, w }) => (
          <span
            key={ticker}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              background: 'var(--bg-inset)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 4,
              padding: '2px 8px',
              color: 'var(--text-primary)',
            }}
          >
            {ticker}
            <span style={{ color: 'var(--text-tertiary)' }}>{(w * 100).toFixed(1)}%</span>
          </span>
        ))}
        {overflow > 0 && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              background: 'var(--bg-inset)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 4,
              padding: '2px 8px',
              color: 'var(--text-tertiary)',
            }}
          >
            +{overflow} more
          </span>
        )}
      </div>

      {/* Context line */}
      {contextLine && (
        <p style={{ fontSize: 12, fontFamily: 'var(--font-sans)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          {contextLine}
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ResearchPage() {
  const store = usePortfolioStore();
  const risk  = useRiskStore();

  const [conversation, setConversation] = useState<QAPair[]>([]);
  const [input,        setInput]        = useState('');
  const [apiKeyMissing, setApiKeyMissing] = useState(false);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const hasPortfolio = store.tickers.length > 0 && store.currentWeights !== null && store.nAssets > 0;

  const context = useMemo(() => {
    if (!hasPortfolio || !store.currentWeights) return null;
    const weights  = Array.from(store.currentWeights);
    const algoKey  = store.activeAlgorithm;
    const cache    = store.algorithmCache[algoKey];
    const ctx: {
      tickers: string[]; weights: number[]; algorithm: string;
      metrics: { annReturn: number; annVol: number; sharpe: number; maxDD: number };
      stressResults?: { period: string; cumReturn: number; maxDD: number }[];
    } = {
      tickers: store.tickers, weights,
      algorithm: ALGO_LABELS[algoKey] ?? algoKey,
      metrics: { annReturn: cache?.ret ?? 0, annVol: cache?.vol ?? 0, sharpe: cache?.sharpe ?? 0, maxDD: 0 },
    };
    if (risk.stressResults.length > 0) {
      ctx.stressResults = risk.stressResults.flatMap((sp) =>
        sp.series.filter((s) => s.label === 'Portfolio').map((s) => ({ period: sp.name, cumReturn: s.cumRet, maxDD: s.maxDD }))
      );
    }
    return ctx;
  }, [hasPortfolio, store, risk.stressResults]);

  const metricCount = context
    ? 4 + context.tickers.length + (context.stressResults?.length ?? 0)
    : 0;

  const mutation = api.ai.analyze.useMutation({
    onSuccess: (data, variables) => {
      setConversation((prev) => prev.map((p) => p.question === variables.question && p.answer === null ? { ...p, answer: data.answer } : p));
    },
    onError: (err, variables) => {
      const msg = err.message ?? 'Unknown error';
      if (msg.includes('GROQ_API_KEY_NOT_SET')) setApiKeyMissing(true);
      setConversation((prev) => prev.map((p) => p.question === variables.question && p.answer === null ? {
        ...p,
        error: msg.includes('GROQ_API_KEY_NOT_SET')
          ? 'Configure GROQ_API_KEY in .env.local to enable AI analysis.'
          : msg.includes('rate_limit') || msg.includes('429')
          ? 'Rate limited — wait a moment and retry.'
          : 'Something went wrong. Please retry.',
      } : p));
    },
  });

  const submit = useCallback((question: string) => {
    if (!question.trim() || !context || mutation.isPending) return;
    const pair: QAPair = { id: _nextId++, question: question.trim(), answer: null, error: null };
    setConversation((prev) => { const next = [...prev, pair]; return next.length > 20 ? next.slice(next.length - 20) : next; });
    setInput('');
    mutation.mutate({ question: question.trim(), context });
  }, [context, mutation]);

  const retry = useCallback((pair: QAPair) => {
    if (!context) return;
    setConversation((prev) => prev.map((p) => p.id === pair.id ? { ...p, error: null, answer: null } : p));
    mutation.mutate({ question: pair.question, context });
  }, [context, mutation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input); }
  };

  // Auto-resize textarea
  const autoResize = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 144) + 'px'; // 6 lines ≈ 144px
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation]);

  const hasInput = input.trim().length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div
          className="slide-enter-content"
          style={{ maxWidth: 760, margin: '0 auto', paddingLeft: 24, paddingRight: 24, paddingTop: 8, paddingBottom: 120, display: 'flex', flexDirection: 'column', gap: 32 }}
        >
          {/* Title — stagger 1 */}
          {/* TODO: past conversations sidebar (slide-in panel, 320px, list of past sessions with date + first question + turn count) */}
          <div>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
              Research Notebook
            </p>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 400, lineHeight: 1.25, color: 'var(--text-primary)', marginBottom: 12 }}>
              What do you want to know about your portfolio?
            </h1>
            <p style={{ fontSize: 15, color: 'var(--text-secondary)', maxWidth: 520, lineHeight: 1.6 }}>
              Ask anything — risk drivers, scenario analysis, comparisons, historical behavior. Answers are grounded in your actual weights and metrics.
            </p>
          </div>

          {/* Context card — stagger 2 */}
          <div>
            {!hasPortfolio ? (
              <Card padding="md">
                <p className="text-h3" style={{ color: 'var(--text-tertiary)', marginBottom: 8 }}>Portfolio context</p>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                  Load a portfolio on{' '}
                  <Link href="/optimize" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Optimize</Link>
                  {' '}first.
                </p>
              </Card>
            ) : (
              <ContextCard store={store} />
            )}
          </div>

          {/* API key notice — stagger 3 (conditional, shifts remaining) */}
          {apiKeyMissing && (
            <div style={{ borderRadius: 'var(--radius-md)', border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.06)', padding: '10px 16px' }}>
              <p style={{ fontSize: 13, color: 'var(--negative)' }}>
                Configure <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>GROQ_API_KEY</code> in{' '}
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>apps/web/.env.local</code> to enable AI analysis.
              </p>
            </div>
          )}

          {/* Suggested questions or conversation — stagger 3 or 4 */}
          {conversation.length === 0 && hasPortfolio && !apiKeyMissing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {SUGGESTION_GROUPS.map((group) => (
                <div key={group.category}>
                  <p style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 4,
                  }}>
                    {group.category}
                  </p>
                  <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    {group.questions.map((q) => (
                      <div key={q} style={{ borderBottom: '1px solid var(--border-subtle)', paddingLeft: 0, paddingRight: 4 }}>
                        <SuggestionRow question={q} onSubmit={submit} disabled={mutation.isPending} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* + New conversation link */}
              {conversation.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                  <button
                    onClick={() => setConversation([])}
                    style={{ fontSize: 13, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    + New conversation
                  </button>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                <AnimatePresence initial={false}>
                  {conversation.map((pair) => (
                    <motion.div
                      key={pair.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
                      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
                    >
                      {/* User bubble — right */}
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <div style={{
                          maxWidth: '70%',
                          background: 'var(--surface-elevated)',
                          borderRadius: 12,
                          borderBottomRightRadius: 4,
                          padding: '12px',
                        }}>
                          <p style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5 }}>{pair.question}</p>
                        </div>
                      </div>

                      {/* AI response — left */}
                      <div>
                        {pair.answer !== null ? (
                          <>
                            <MarkdownText text={pair.answer} />
                            <p style={{ marginTop: 10, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>
                              Grounded in your portfolio · {metricCount} metrics{store.nPeriods > 0 ? ` · ${store.nPeriods.toLocaleString()} days` : ''}
                            </p>
                          </>
                        ) : pair.error !== null ? (
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <p style={{ fontSize: 13, color: 'var(--text-secondary)', flex: 1 }}>{pair.error}</p>
                            {!pair.error.includes('Configure') && (
                              <button onClick={() => retry(pair)} style={{ flexShrink: 0, fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}>
                                Retry
                              </button>
                            )}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)' }}>
                            <Spinner />
                            <span style={{ fontSize: 13 }}>Analysing…</span>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Fixed input bar */}
      {hasPortfolio && (
        <div style={{
          flexShrink: 0,
          background: 'var(--bg)',
          borderTop: '1px solid var(--border-subtle)',
          padding: '16px 24px',
        }}>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            <div style={{
              position: 'relative',
              background: 'var(--bg)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              transition: `border-color var(--duration-micro) var(--ease)`,
            }}
              className="focus-within:border-[var(--border-strong)]"
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); autoResize(); }}
                onKeyDown={handleKeyDown}
                disabled={mutation.isPending}
                placeholder="Ask about your portfolio..."
                rows={1}
                style={{
                  display: 'block',
                  width: '100%',
                  minHeight: 48,
                  maxHeight: 144,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontSize: 14,
                  color: 'var(--text-primary)',
                  resize: 'none',
                  lineHeight: '22px',
                  paddingTop: 13,
                  paddingBottom: 13,
                  paddingLeft: 16,
                  paddingRight: 52,
                  overflowY: 'auto',
                }}
                className="placeholder:text-tertiary"
                autoFocus
              />

              <div style={{ position: 'absolute', right: 8, bottom: 8 }}>
                {mutation.isPending ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 32, height: 32, color: 'var(--text-tertiary)',
                  }}>
                    <Spinner />
                  </div>
                ) : (
                  <button
                    onClick={() => submit(input)}
                    disabled={!hasInput}
                    aria-label="Send"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: hasInput ? 'var(--accent)' : 'var(--border-subtle)',
                      border: 'none',
                      cursor: hasInput ? 'pointer' : 'default',
                      color: 'white',
                      transition: `background var(--duration-micro) var(--ease)`,
                    }}
                  >
                    <ArrowUp size={14} strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
            <p style={{ marginTop: 6, fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
              Powered by Groq · Enter to send
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
