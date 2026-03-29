import type { Metadata, Viewport } from 'next';
import { Share_Tech_Mono, IBM_Plex_Mono, Courier_Prime } from 'next/font/google';
import { SocketProvider } from '@/components/providers/socket-provider';
import { ToastProvider } from '@/components/providers/toast-provider';
import { TacTooltipProvider } from '@/components/ui/tac-tooltip';
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

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
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
          {children}
          <ToastProvider />
          <TacTooltipProvider />
        </SocketProvider>
      </body>
    </html>
  );
}
