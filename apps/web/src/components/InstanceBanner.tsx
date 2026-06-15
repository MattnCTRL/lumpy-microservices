'use client';

import { useEffect, useState } from 'react';

/**
 * A thin warning strip when the UI is talking to a LOCAL DEV orchestrator
 * (page served from localhost), so a dev instance is never mistaken for the live
 * box. The box is reached via its tailnet IP / MagicDNS name, never localhost.
 */
export function InstanceBanner() {
  const [dev, setDev] = useState(false);

  useEffect(() => {
    const host = window.location.hostname;
    setDev(host === 'localhost' || host === '127.0.0.1' || host === '[::1]');
  }, []);

  if (!dev) return null;
  return (
    <div className="bg-amber-600/90 px-3 py-1 text-center text-xs font-medium text-black">
      local dev - not the live box
    </div>
  );
}
