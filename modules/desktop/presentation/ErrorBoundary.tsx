import React from 'react';

export class ErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="h-screen flex flex-col items-center justify-center gap-4 bg-neutral-950 text-neutral-100 p-8 text-center">
        <img src="./icon.svg" alt="" className="w-20 h-20" />
        <h1 className="text-xl font-semibold">Simply Logs needs a fresh start</h1>
        <p className="text-neutral-400 max-w-lg">{this.state.error.message}</p>
        <p className="text-sm text-neutral-400">Your saved projects and credentials will not be removed.</p>
        <button onClick={() => location.reload()} className="px-4 py-2 rounded-lg bg-indigo-600">Reload Simply Logs</button>
      </main>
    );
  }
}
