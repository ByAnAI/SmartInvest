import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { teardownSupabaseForPageUnload } from './services/supabase';

const rootElement = document.getElementById('root');

type RootBoundaryProps = { children: React.ReactNode };
type RootBoundaryState = { error: Error | null };

class RootErrorBoundary extends React.Component<RootBoundaryProps, RootBoundaryState> {
  state: RootBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RootBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      const msg = this.state.error.message || String(this.state.error);
      const stack = this.state.error.stack || '';
      return (
        <div
          style={{
            minHeight: '100vh',
            padding: '2rem',
            fontFamily: 'system-ui, sans-serif',
            background: '#fef2f2',
            color: '#7f1d1d',
          }}
        >
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.75rem' }}>SmartInvest failed to render</h1>
          <p style={{ marginBottom: '1rem', maxWidth: '42rem', lineHeight: 1.5 }}>
            Open DevTools → Console. If the dev server stopped, move the repo out of iCloud/OneDrive or keep this
            project open in a non-synced folder. Hard-refresh (⌘⇧R) after restarting <code style={{ background: '#fee2e2', padding: '0 4px', borderRadius: 4 }}>npm run dev</code>.
          </p>
          <pre
            style={{
              padding: '1rem',
              background: '#fff',
              border: '1px solid #fecaca',
              borderRadius: 8,
              overflow: 'auto',
              fontSize: '12px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {msg}
            {stack ? `\n\n${stack}` : ''}
          </pre>
        </div>
      );
    }
    return <>{(this as unknown as React.Component<RootBoundaryProps>).props.children}</>;
  }
}

window.addEventListener('error', (event) => {
  console.error(event.error ?? event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled rejection:', event.reason);
});

/** Helps tabs close/reload without waiting on Supabase Realtime sockets or lingering locks. */
window.addEventListener('pagehide', () => {
  teardownSupabaseForPageUnload();
});

if (!rootElement) {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<p style="padding:2rem;font-family:system-ui">SmartInvest: missing #root in index.html.</p>'
  );
} else {
  const root = ReactDOM.createRoot(rootElement);
  /** No StrictMode: in dev it double-mounts effects and can churn Supabase auth subscriptions. */
  root.render(
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  );
}
