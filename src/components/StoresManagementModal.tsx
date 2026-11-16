'use client';

import { useState, useEffect, useCallback } from 'react';

interface Store {
  id: string;
  name: string;
  created_at: string;
}

interface StoresManagementModalProps {
  onClose: () => void;
}

export default function StoresManagementModal({ onClose }: StoresManagementModalProps) {
  const [stores,   setStores]   = useState<Store[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [working,  setWorking]  = useState(false);
  const [error,    setError]    = useState('');
  const [newName,  setNewName]  = useState('');
  // { id: string, key: string } when a key is freshly generated — shown once
  const [revealed, setRevealed] = useState<{ id: string; key: string; label: string } | null>(null);

  const loadStores = useCallback(async () => {
    try {
      const res  = await fetch('/api/admin/stores');
      const json = await res.json() as { data?: Store[] };
      setStores(json.data ?? []);
    } catch {
      setError('Failed to load stores.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStores(); }, [loadStores]);

  async function createStore() {
    const name = newName.trim();
    if (!name) return;
    setWorking(true);
    setError('');
    try {
      const res  = await fetch('/api/admin/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const json = await res.json() as { id?: string; name?: string; created_at?: string; access_key?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed to create store');
      setNewName('');
      setRevealed({ id: json.id!, key: json.access_key!, label: `Store "${json.name}" created` });
      await loadStores();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create store');
    } finally {
      setWorking(false);
    }
  }

  async function resetKey(id: string, name: string) {
    if (!confirm(`Reset the access key for "${name}"? All existing Store Admin sessions for this store will be invalidated immediately.`)) return;
    setWorking(true);
    setError('');
    try {
      const res  = await fetch('/api/admin/stores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'reset-key' }),
      });
      const json = await res.json() as { success?: boolean; access_key?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed to reset key');
      setRevealed({ id, key: json.access_key!, label: `New key for "${name}"` });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reset key');
    } finally {
      setWorking(false);
    }
  }

  async function deleteStore(id: string, name: string) {
    if (!confirm(`Delete store "${name}"? This will remove all its game selections. Master games and images are NOT deleted.`)) return;
    setWorking(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/stores?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? 'Failed to delete store');
      }
      if (revealed?.id === id) setRevealed(null);
      await loadStores();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete store');
    } finally {
      setWorking(false);
    }
  }

  async function copyToClipboard(text: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="stores-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 id="stores-modal-title" className="text-base font-semibold text-slate-900">Manage Stores</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {/* One-time key reveal */}
          {revealed && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
              <p className="text-xs font-semibold text-amber-800">{revealed.label} — save this key now</p>
              <p className="text-xs text-amber-700 leading-relaxed">
                This access key will <strong>never be shown again</strong>. Copy it and give it to the store admin.
              </p>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-amber-700 font-medium w-20">Store ID</span>
                  <code className="flex-1 text-xs font-mono bg-white border border-amber-200 rounded px-2 py-1 truncate">{revealed.id}</code>
                  <button onClick={() => copyToClipboard(revealed.id)} className="text-amber-600 hover:text-amber-800 flex-shrink-0" title="Copy Store ID">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-amber-700 font-medium w-20">Access Key</span>
                  <code className="flex-1 text-xs font-mono bg-white border border-amber-200 rounded px-2 py-1 truncate">{revealed.key}</code>
                  <button onClick={() => copyToClipboard(revealed.key)} className="text-amber-600 hover:text-amber-800 flex-shrink-0" title="Copy Access Key">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </button>
                </div>
              </div>
              <button onClick={() => setRevealed(null)} className="text-xs text-amber-600 hover:text-amber-800 underline">Dismiss</button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">{error}</div>
          )}

          {/* Stores list */}
          {loading ? (
            <div className="flex justify-center py-8">
              <svg className="w-6 h-6 text-slate-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          ) : stores.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">No stores yet. Create one below.</p>
          ) : (
            <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
              {stores.map((store) => (
                <li key={store.id} className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-slate-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800">{store.name}</p>
                    <p className="text-xs text-slate-400 font-mono truncate">{store.id}</p>
                  </div>
                  <button
                    onClick={() => resetKey(store.id, store.name)}
                    disabled={working}
                    className="text-xs text-slate-500 hover:text-brand-600 transition-colors flex-shrink-0"
                    title="Reset access key"
                  >
                    Reset key
                  </button>
                  <button
                    onClick={() => deleteStore(store.id, store.name)}
                    disabled={working}
                    className="text-xs text-red-500 hover:text-red-700 transition-colors flex-shrink-0"
                    title="Delete store"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Create store */}
          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs font-medium text-slate-700 mb-2">Create a new store</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createStore(); }}
                placeholder="Store name…"
                className="input-field text-sm flex-1"
              />
              <button
                onClick={createStore}
                disabled={working || !newName.trim()}
                className="btn-primary text-sm flex-shrink-0 disabled:opacity-40"
              >
                {working ? '…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
