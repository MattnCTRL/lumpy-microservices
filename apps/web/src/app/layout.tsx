import type { Metadata, Viewport } from 'next';
import '@xterm/xterm/css/xterm.css';
import './globals.css';
import { AuthGate } from '@/components/AuthGate';
import { TopNav } from '@/components/TopNav';

export const metadata: Metadata = {
  title: 'Lumpy Micro Services',
  description: 'Orchestrate Claude Code sessions and monitor your server fleet.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-mono">
        <AuthGate>
          <div className="flex h-screen flex-col">
            <TopNav />
            <div className="min-h-0 flex-1">{children}</div>
          </div>
        </AuthGate>
      </body>
    </html>
  );
}
