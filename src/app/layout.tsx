import type { Metadata } from 'next';
import { Share_Tech_Mono, IBM_Plex_Mono, Courier_Prime } from 'next/font/google';
import { SocketProvider } from '@/components/providers/socket-provider';
import { AppShell } from '@/components/layout/app-shell';
import './globals.css';

const shareTechMono = Share_Tech_Mono({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-share-tech-mono',
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-ibm-plex-mono',
});

const courierPrime = Courier_Prime({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-courier-prime',
});

export const metadata: Metadata = {
  title: 'NYHZ OPS — DEVROOM',
  description: 'Agent Orchestrator — Tactical Operations Center',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${shareTechMono.variable} ${ibmPlexMono.variable} ${courierPrime.variable}`}>
      <body>
        <SocketProvider>
          <AppShell>
            {children}
          </AppShell>
        </SocketProvider>
      </body>
    </html>
  );
}
