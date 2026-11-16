'use client';

import { useState, useEffect, useCallback } from 'react';

interface Store {
  id: string;
  name: string;
  username: string;
  is_active: boolean;
  created_at: string;
}

type EditMode =
  | { type: 'rename';   id: string; current: string }
  | { type: 'username'; id: string; current: string }
  | { type: 'password'; id: string; name: string };

interface StoresManagementModalProps {
  onClose: () => void;
}

export default function StoresManagementModal({ onClose }: StoresManagementModalProps) {
  const [stores,  setStores]  = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error,   setError]   = useState('');
  const [toast,   setToast]   = useState('');

  // Create form
  const [newName,     setNewName]     = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Inline edit state
  const [editMode,   setEditMode]   = useState<EditMode | null>(null);
  const [editValue,  setEditValue]  = useState('');
  const [editValue2, setEditValue2] = useState(''); // confirm password

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

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

  // ── Create ──────────────────────────────────────────────────────────

  async function createStore() {
    const name     = newName.trim();
    const username = newUsername.trim();
    const password = newPassword;
    if (!name || !username || !password) return;
    setWorking(true);
    setError('');
    try {
      const res  = await fetch('/api/admin/stores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username, password }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed to create store');
      setNewName(''); setNewUsername(''); setNewPassword('');
      showToast(`Store "${name}" created`);
      await loadStores();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create store');
    } finally {
      setWorking(false);
    }
  }

  // ── Edit helpers ────────────────────────────────────────────────────

  function startEdit(mode: EditMode) {
    setEditMode(mode);
    setEditValue(mode.type === 'password' ? '' : mode.current);
    setEditValue2('');
    setError('');
  }

  function cancelEdit() {
    setEditMode(null);
    setEditValue('');
    setEditValue2('');
    setError('');
  }

  async function commitEdit() {
    if (!editMode) return;
    setWorking(true);
    setError('');
    try {
      let body: Record<string, string> = { id: editMode.id };
      let label = '';

      if (editMode.type === 'rename') {
        const v = editValue.trim();
        if (!v) { setError('Name cannot be empty'); setWorking(false); return; }
        body.name = v;
        label = 'Name updated';
      } else if (editMode.type === 'username') {
        const v = editValue.trim().toLowerCase();
        if (!v) { setError('Username cannot be empty'); setWorking(false); return; }
        body.username = v;
        label = 'Username updated';
      } else if (editMode.type === 'password') {
        if (editValue.length < 6)  { setError('Password must be at least 6 characters'); setWorking(false); return; }
        if (editValue !== editValue2) { setError('Passwords do not match'); setWorking(false); return; }
        body = { id: editMode.id, action: 'reset-password', password: editValue };
        label = `Password reset for "${editMode.name}"`;
      }

      const res  = await fetch('/api/admin/stores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Update failed');
      cancelEdit();
      showToast(label);
      await loadStores();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setWorking(false);
    }
  }

  // ── Toggle active ───────────────────────────────────────────────────

  async function toggleActive(store: Store) {
    const action = store.is_active ? 'deactivate' : 'activate';
    if (!confirm(`${action === 'deactivate' ? 'Deactivate' : 'Activate'} store "${store.name}"?${action === 'deactivate' ? ' Active sessions will be revoked immediately.' : ''}`)) return;
    setWorking(true);
    setError('');
    try {
      const res  = await fetch('/api/admin/stores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: store.id, action: 'toggle-active' }),
      });
      if (!res.ok) { const j = await res.json() as { error?: string }; throw new Error(j.error); }
      showToast(`Store "${store.name}" ${store.is_active ? 'deactivated' : 'activated'}`);
      await loadStores();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setWorking(false);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────

  async function deleteStore(id: string, name: string) {
    if (!confirm(`Delete store "${name}"? Game selections will be removed. Master games and images are NOT deleted.`)) return;
    setWorking(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/stores?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json() as { error?: string }; throw new Error(j.error); }
      if (editMode?.id === id) cancelEdit();
      showToast(`Store "${name}" deleted`);
      await loadStores();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete store');
    } finally {
      setWorking(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="stores-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-xl border border-slate-100 max-h-[92vh] flex flex-col overflow-hidden">
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
                <li key={store.id} className="bg-white">
                  {/* Main row */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Status dot */}
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${store.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800">{store.name}</p>
                      <p className="text-xs text-slate-400">@{store.username} · {store.is_active ? 'Active' : 'Inactive'}</p>
                    </div>
                    {/* Action buttons */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => startEdit({ type: 'rename',   id: store.id, current: store.name })}     disabled={working} className="text-xs text-slate-500 hover:text-brand-600 px-2 py-1 rounded hover:bg-slate-50 transition-colors" title="Edit name">Name</button>
                      <button onClick={() => startEdit({ type: 'username', id: store.id, current: store.username })} disabled={working} className="text-xs text-slate-500 hover:text-brand-600 px-2 py-1 rounded hover:bg-slate-50 transition-colors" title="Change username">User</button>
                      <button onClick={() => startEdit({ type: 'password', id: store.id, name: store.name })}        disabled={working} className="text-xs text-slate-500 hover:text-brand-600 px-2 py-1 rounded hover:bg-slate-50 transition-colors" title="Reset password">Pass</button>
                      <button onClick={() => toggleActive(store)} disabled={working}
                        className={`text-xs px-2 py-1 rounded transition-colors ${store.is_active ? 'text-amber-600 hover:text-amber-800 hover:bg-amber-50' : 'text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50'}`}
                        title={store.is_active ? 'Deactivate' : 'Activate'}>
                        {store.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => deleteStore(store.id, store.name)} disabled={working} className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors" title="Delete">Delete</button>
                    </div>
                  </div>

                  {/* Inline edit panel */}
                  {editMode && editMode.id === store.id && (
                    <div className="px-4 pb-3 pt-0 bg-slate-50 border-t border-slate-100 space-y-2">
                      {editMode.type === 'rename' && (
                        <div>
                          <label className="text-xs font-medium text-slate-600 block mb-1">New store name</label>
                          <input autoFocus type="text" value={editValue} onChange={e => setEditValue(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && commitEdit()}
                            className="input-field text-sm" placeholder="Store name…" />
                        </div>
                      )}
                      {editMode.type === 'username' && (
                        <div>
                          <label className="text-xs font-medium text-slate-600 block mb-1">New username</label>
                          <input autoFocus type="text" value={editValue} onChange={e => setEditValue(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && commitEdit()}
                            className="input-field text-sm font-mono" placeholder="new-username" autoCapitalize="none" />
                        </div>
                      )}
                      {editMode.type === 'password' && (
                        <div className="space-y-2">
                          <div>
                            <label className="text-xs font-medium text-slate-600 block mb-1">New password</label>
                            <input autoFocus type="password" value={editValue} onChange={e => setEditValue(e.target.value)}
                              className="input-field text-sm" placeholder="At least 6 characters" />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-slate-600 block mb-1">Confirm password</label>
                            <input type="password" value={editValue2} onChange={e => setEditValue2(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && commitEdit()}
                              className="input-field text-sm" placeholder="Repeat password" />
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2 pt-1">
                        <button onClick={commitEdit} disabled={working} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40">
                          {working ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={cancelEdit} className="btn-secondary text-xs px-3 py-1.5">Cancel</button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Create store form */}
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <p className="text-xs font-semibold text-slate-700">Create a new store</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input type="text" value={newName}     onChange={e => setNewName(e.target.value)}
                placeholder="Store name" className="input-field text-sm" />
              <input type="text" value={newUsername} onChange={e => setNewUsername(e.target.value)}
                placeholder="Username" className="input-field text-sm font-mono" autoCapitalize="none" />
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createStore()}
                placeholder="Password (min 6)" className="input-field text-sm" />
            </div>
            <button
              onClick={createStore}
              disabled={working || !newName.trim() || !newUsername.trim() || newPassword.length < 6}
              className="btn-primary text-sm disabled:opacity-40"
            >
              {working ? 'Creating…' : 'Create store'}
            </button>
          </div>
        </div>

        {/* Toast */}
        {toast && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs font-medium px-4 py-2.5 rounded-xl shadow-lg whitespace-nowrap">
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
