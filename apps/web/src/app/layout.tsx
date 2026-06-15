import type { Metadata, Viewport } from 'next';
import '@xterm/xterm/css/xterm.css';
import './globals.css';
import { AuthGate } from '@/components/AuthGate';
import { InstanceBanner } from '@/components/InstanceBanner';
import { SideNav } from '@/components/SideNav';
import { Toaster } from '@/components/Toaster';

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
  // env(safe-area-inset-*) - needed for the mobile bottom nav.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-mono">
        <InstanceBanner />
        <Toaster />
        <AuthGate>
          {/* Mobile: full-height shell (dvh) with a fixed bottom tab bar that
              floats over the content. Desktop: left rail beside the content. */}
          <div className="app-shell md:flex md:flex-row">
            <SideNav />
            <main className="has-tabbar h-full min-h-0 min-w-0 overflow-hidden md:flex-1">
              {children}
            </main>
          </div>
        </AuthGate>
      </body>
    </html>
  );
}
