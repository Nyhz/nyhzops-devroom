'use client';

import { Toaster } from 'sonner';

export function ToastProvider() {
  return (
    <Toaster
      position="bottom-right"
      theme="dark"
      toastOptions={{
        style: {
          background: '#111a11',
          border: '1px solid #2a3a2a',
          color: '#c8e6c8',
          fontFamily: 'var(--font-tactical), monospace',
          borderRadius: '0',
        },
        className: 'font-tactical',
      }}
    />
  );
}
