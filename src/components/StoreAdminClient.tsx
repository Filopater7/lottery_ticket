'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import type { LotteryItem } from '@/types';

interface StoreAdminClientProps {
  storeId:            string;
  storeName:          string;
  allItems:           LotteryItem[];
  initialSelectedIds: string[];
}

const PLACEHOLDER = (num: number) =>
  `https://placehold.co/400x240/1e293b/94a3b8?text=${encodeURIComponent(`#${num}`)}`;

export default function StoreAdminClient({
  storeId,
  storeName,
  allItems,
  initialSelectedIds,
}: StoreAdminClientProps) {
  const router = useRouter();

  // Ordered list of selected item IDs
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);
  const [search,      setSearch]      = useState('');
  const [saving,      setSaving]      = useState(false);
  const [toast,       setToast]       = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Drag-and-drop state (native HTML5)
  const dragIndexRef = useRef<number | null>(null);

  // Build lookup map for fast access
  const itemMap = useMemo(() => {
    const m = new Map<string, LotteryItem>();
    allItems.forEach((item) => m.set(item.id, item));
    return m;
  }, [allItems]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Available items = all master items not currently selected, filtered by search
  const available = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((item) => {
      if (selectedSet.has(item.id)) return false;
      if (!q) return true;
      return (
        item.number.toString().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        (item.code?.toLowerCase() ?? '').includes(q)
      );
    });
  }, [allItems, selectedSet, search]);

  const selectedItems = useMemo(
    () => selectedIds.map((id) => itemMap.get(id)).filter(Boolean) as LotteryItem[],
    [selectedIds, itemMap],
  );

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  // Add an item to the selection (append to end)
  const addItem = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  // Remove an item from the selection
  const removeItem = useCallback((id: string) => {
    setSelectedIds((prev) => prev.filter((i) => i !== id));
  }, []);

  // ── Drag-and-drop reorder ─────────────────────────────────────────────

  function onDragStart(index: number) {
    dragIndexRef.current = index;
  }

  function onDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    const from = dragIndexRef.current;
    if (from === null || from === index) return;
    setSelectedIds((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      dragIndexRef.current = index;
      return next;
    });
  }

  function onDragEnd() {
    dragIndexRef.current = null;
  }

  // ── Save ─────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/store/selection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_ids: selectedIds }),
        credentials: 'same-origin',
      });
      const json = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Save failed');
      showToast('success', `Saved ${selectedIds.length} game${selectedIds.length !== 1 ? 's' : ''}`);
      router.refresh();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/store/auth', { method: 'DELETE', credentials: 'same-origin' });
    router.push('/store-admin/login');
    router.refresh();
  }

  const isDirty = JSON.stringify(selectedIds) !== JSON.stringify(initialSelectedIds);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white border-b border-slate-100 shadow-sm">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.75c0 .415.336.75.75.75z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-slate-900 truncate">{storeName}</span>
            <span className="hidden sm:inline text-xs text-slate-400">Store Admin</span>
          </div>
          <div className="flex items-center gap-3">
            {isDirty && (
              <span className="hidden sm:inline text-xs text-amber-600 font-medium">Unsaved changes</span>
            )}
            <button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button onClick={handleLogout} className="btn-secondary text-xs px-3 py-1.5">
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Two-panel layout */}
      <div className="flex-1 max-w-screen-xl mx-auto w-full px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Left: Available games ──────────────────────────────────────── */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Available games
              <span className="ml-2 text-xs font-normal text-slate-400">{available.length}</span>
            </h2>
          </div>

          {/* Search */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by number, code, or title…"
              className="input-field pl-9 text-sm"
            />
          </div>

          {/* List */}
          <div className="card overflow-hidden flex-1 overflow-y-auto max-h-[calc(100vh-220px)]">
            {available.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-400">
                {search ? 'No games match your search.' : 'All games are already selected.'}
              </div>
            ) : (
              <ul className="divide-y divide-slate-50">
                {available.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                    {/* Thumbnail */}
                    <div className="w-14 h-9 rounded bg-slate-100 overflow-hidden flex-shrink-0">
                      <Image
                        src={item.image_url || PLACEHOLDER(item.number)}
                        alt=""
                        width={56}
                        height={36}
                        className="object-cover w-full h-full"
                        unoptimized={!item.image_url}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold font-mono text-slate-500">
                        {item.code ?? `#${item.number}`}
                      </p>
                      <p className="text-sm font-medium text-slate-800 truncate">{item.title || '—'}</p>
                    </div>
                    {item.price != null && (
                      <span className="text-xs font-semibold text-slate-500 flex-shrink-0">${item.price}</span>
                    )}
                    {!item.enabled && (
                      <span className="text-xs text-slate-400 flex-shrink-0">Hidden</span>
                    )}
                    <button
                      onClick={() => addItem(item.id)}
                      className="flex-shrink-0 w-7 h-7 rounded-full bg-brand-600 text-white flex items-center justify-center hover:bg-brand-700 transition-colors"
                      aria-label={`Add ${item.title}`}
                      title="Add to selection"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ── Right: Selected games ──────────────────────────────────────── */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Selected for this store
              <span className="ml-2 text-xs font-normal text-slate-400">{selectedItems.length}</span>
            </h2>
            {selectedItems.length > 0 && (
              <button
                onClick={() => setSelectedIds([])}
                className="text-xs text-slate-400 hover:text-red-500 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="card overflow-hidden flex-1 overflow-y-auto max-h-[calc(100vh-220px)]">
            {selectedItems.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-400">
                No games selected yet. Add games from the left panel.
              </div>
            ) : (
              <ul className="divide-y divide-slate-50">
                {selectedItems.map((item, index) => (
                  <li
                    key={item.id}
                    draggable
                    onDragStart={() => onDragStart(index)}
                    onDragOver={(e) => onDragOver(e, index)}
                    onDragEnd={onDragEnd}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors cursor-grab active:cursor-grabbing"
                  >
                    {/* Drag handle */}
                    <svg className="w-4 h-4 text-slate-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
                    </svg>
                    {/* Order number */}
                    <span className="w-6 text-xs font-mono text-slate-400 flex-shrink-0 text-center">{index + 1}</span>
                    {/* Thumbnail */}
                    <div className="w-14 h-9 rounded bg-slate-100 overflow-hidden flex-shrink-0">
                      <Image
                        src={item.image_url || PLACEHOLDER(item.number)}
                        alt=""
                        width={56}
                        height={36}
                        className="object-cover w-full h-full"
                        unoptimized={!item.image_url}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold font-mono text-slate-500">
                        {item.code ?? `#${item.number}`}
                      </p>
                      <p className="text-sm font-medium text-slate-800 truncate">{item.title || '—'}</p>
                    </div>
                    {item.price != null && (
                      <span className="text-xs font-semibold text-slate-500 flex-shrink-0">${item.price}</span>
                    )}
                    <button
                      onClick={() => removeItem(item.id)}
                      className="flex-shrink-0 w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-red-100 hover:text-red-600 transition-colors"
                      aria-label={`Remove ${item.title}`}
                      title="Remove from selection"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-xs text-slate-400">
            Drag items to reorder. Changes are not saved until you click <strong>Save changes</strong>.
          </p>
        </section>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-4 right-4 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-medium z-50 ${
          toast.type === 'success' ? 'bg-slate-900 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.type === 'success' ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          )}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
