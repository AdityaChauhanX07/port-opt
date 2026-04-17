import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0a] text-white px-6">
      <div className="max-w-md text-center">
        <p className="mono text-[11px] uppercase tracking-[0.2em] text-[#525252] mb-6">
          Quantitative Portfolio Optimization
        </p>
        <h1 className="text-[2.5rem] font-semibold tracking-tight leading-none mb-4" style={{ fontFamily: 'Georgia, serif' }}>
          PortOpt
        </h1>
        <p className="text-[14px] text-[#737373] leading-relaxed mb-10">
          Build, test, and analyse institutional-quality portfolios — powered by a Rust optimization engine and live market data.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-md bg-[#5e8eff] px-5 py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5e8eff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a]"
        >
          Launch app
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </Link>
      </div>
    </main>
  );
}
