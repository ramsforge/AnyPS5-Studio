import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './index.css';

// Any render error would otherwise leave an empty black window; show what happened and a way out instead.
class CrashScreen extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div data-nav-scope className="fixed inset-0 flex items-center justify-center p-6 bg-[#04060a]">
        <div className="max-w-lg w-full rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
          <h1 className="text-lg font-semibold text-white">AnyPS5 Studio ran into a problem</h1>
          <p className="text-xs text-white/60 leading-relaxed">
            Something on this screen failed to load. Your games and settings are unchanged. Reloading usually fixes it; if it
            keeps happening, include the details below when reporting the issue.
          </p>
          <pre className="text-[11px] font-mono text-red-300/80 bg-black/40 rounded-lg p-3 max-h-40 overflow-auto whitespace-pre-wrap select-text">
            {this.state.error.message}
          </pre>
          <button
            autoFocus
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-full bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors"
          >
            Reload Studio
          </button>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <CrashScreen>
      <App />
    </CrashScreen>
  </React.StrictMode>
);
