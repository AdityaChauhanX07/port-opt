import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
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

export const metadata: Metadata = {
  title: 'PortOpt — Quantitative Portfolio Intelligence',
  description:
    'Build, test, and analyse institutional-quality portfolios — powered by a Rust optimization engine and live market data.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <Providers>
          <TRPCProvider>{children}</TRPCProvider>
        </Providers>
      </body>
    </html>
  );
}
