import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Spectral } from 'next/font/google';
import { TRPCProvider } from '@/lib/trpc/provider';
import { Providers } from './providers';
import '../styles/globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

const spectral = Spectral({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'PortOpt — Quantitative Portfolio Intelligence',
  description:
    'Build, test, and analyse institutional-quality portfolios — powered by a Rust optimization engine and live market data.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${inter.variable} ${jetbrainsMono.variable} ${spectral.variable}`}
    >
      <head>
        {/* Apply persisted theme before first paint to prevent flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('portopt-theme')||'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){}`,
          }}
        />
      </head>
      <body>
        <Providers>
          <TRPCProvider>{children}</TRPCProvider>
        </Providers>
      </body>
    </html>
  );
}
