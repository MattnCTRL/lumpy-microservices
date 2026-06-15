import type { Metadata, Viewport } from 'next';
import '@xterm/xterm/css/xterm.css';
import './globals.css';
import { AuthGate } from '@/components/AuthGate';
import { SideNav } from '@/components/SideNav';

export const metadata: Metadata = {
  title: 'Lumpy Micro Services',
  description: 'Orchestrate Claude Code sessions and monitor your server fleet.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#0a0a0a',
  width: 'device-width',
  initialScale: 1,
  // Let content extend under the notch/home indicator so we can pad with
  // env(safe-area-inset-*) — needed for the mobile bottom nav.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-mono">
        <AuthGate>
          {/* Mobile: content with a bottom tab bar (col-reverse). Desktop: left rail. */}
          <div className="flex h-screen flex-col-reverse md:flex-row">
            <SideNav />
            <div className="min-h-0 min-w-0 flex-1">{children}</div>
          </div>
        </AuthGate>
      </body>
    </html>
  );
}
