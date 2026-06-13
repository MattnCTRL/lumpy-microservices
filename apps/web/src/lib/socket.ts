export interface SocketHandle {
  close: () => void;
}

/**
 * A WebSocket that transparently reconnects with capped exponential backoff, so
 * the UI tolerates the orchestrator being briefly down, still starting, or
 * restarting. Only text-frame messages are forwarded to `onMessage`.
 */
export function reconnectingSocket(url: string, onMessage: (data: string) => void): SocketHandle {
  let socket: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let backoff = 1000;

  const connect = () => {
    if (closed) return;
    socket = new WebSocket(url);
    socket.onopen = () => {
      backoff = 1000;
    };
    socket.onmessage = (event) => {
      if (typeof event.data === 'string') onMessage(event.data);
    };
    socket.onclose = () => {
      if (closed || retry) return;
      retry = setTimeout(() => {
        retry = null;
        backoff = Math.min(backoff * 2, 15000);
        connect();
      }, backoff);
    };
    socket.onerror = () => socket?.close();
  };

  connect();

  return {
    close: () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    },
  };
}
