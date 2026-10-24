'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import type { LotteryItem, ItemFormData } from '@/types';
import { PRICE_TIERS } from '@/types';
import EditItemModal from './EditItemModal';
import FilterBar, { type FilterValue } from './FilterBar';
import { useRouter } from 'next/navigation';

interface Props {
  initialItems: LotteryItem[];
  userEmail: string;
  isDemo?: boolean;
}

export default function AdminDashboardClient({ initialItems, userEmail, isDemo = false }: Props) {
  const [items, setItems] = useState<LotteryItem[]>(initialItems);
  const [modalItem, setModalItem] = useState<LotteryItem | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterValue>('all');
  const router = useRouter();

  // Sync items when server re-renders after router.refresh()
  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  // Counts per price tier (always based on full list, ignoring search)
  const counts = useMemo(() => {
    const result: Record<FilterValue, number> = { all: items.length } as Record<FilterValue, number>;
    for (const tier of PRICE_TIERS) {
      result[tier] = items.filter((item) => item.price === tier).length;
    }
    return result;
  }, [items]);

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  const filtered = useMemo(() => {
    let list = items;
    if (filter !== 'all') list = list.filter((item) => item.price === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (item) =>
          item.number.toString().includes(q) ||
          (item.code?.toLowerCase() ?? '').includes(q) ||
          item.title.toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, filter, search]);

  async function handleLogout() {
    const { createSupabaseBrowserClient } = await import('@/lib/supabase/client');
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/admin/login');
    router.refresh();
  }

  const handleSave = useCallback(async (data: ItemFormData, id?: string) => {
    const method = id ? 'PUT' : 'POST';
    const body = id ? { id, ...data } : data;
    const res = await fetch('/api/admin/items', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Save failed');

    if (id) {
      setItems((prev) => prev.map((item) => (item.id === id ? json.data : item)));
      showToast('success', `Ticket #${data.number} updated`);
    } else {
      setItems((prev) => [...prev, json.data].sort((a, b) => a.number - b.number));
      showToast('success', `Ticket #${data.number} added`);
    }
    setModalItem(undefined);
    router.refresh();
  }, [router]);

  async function handleToggleEnabled(item: LotteryItem) {
    const res = await fetch('/api/admin/items', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, number: item.number, code: item.code, title: item.title, image_url: item.image_url, price: item.price, enabled: !item.enabled }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast('error', json.error || 'Failed to update visibility');
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? json.data : i)));
    showToast('success', `Ticket #${item.number} ${!item.enabled ? 'shown' : 'hidden'}`);
    router.refresh();
  }

  async function handleDelete(item: LotteryItem) {
    if (!confirm(`Delete ticket #${item.number} "${item.title}"? This cannot be undone.`)) return;
    setDeleting(item.id);
    try {
      const res = await fetch(`/api/admin/items?id=${item.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Delete failed');
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      showToast('success', `Ticket #${item.number} deleted`);
      router.refresh();
    } catch (err: unknown) {
      showToast('error', err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Demo mode banner */}
      {isDemo && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center">
          <p className="text-xs text-amber-800 font-medium">
            Demo mode — no database connected. Changes are not saved.{' '}
            <span className="text-amber-600">Add your Supabase credentials to <code className="font-mono bg-amber-100 px-1 rounded">.env.local</code> to enable persistence.</span>
          </p>
        </div>
      )}
      {/* Top nav */}
      <header className="sticky top-0 z-10 bg-white border-b border-slate-100 shadow-sm">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-slate-900">Admin Dashboard</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500 hidden sm:block">{userEmail}</span>
            <a href="/" target="_blank" rel="noopener" className="btn-secondary text-xs px-3 py-1.5">
              View display
            </a>
            <button onClick={handleLogout} className="btn-secondary text-xs px-3 py-1.5">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Page heading + add */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Lottery Tickets</h1>
            <p className="text-xs text-slate-500 mt-0.5">{items.length} tickets · {items.filter(i => i.enabled).length} visible</p>
          </div>
          <button onClick={() => setModalItem(null)} className="btn-primary text-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add ticket
          </button>
        </div>

        {/* Filter bar */}
        <FilterBar
          active={filter}
          counts={counts}
          onChange={(v) => { setFilter(v); setSearch(''); }}
        />

        {/* Search */}
        <div className="max-w-xs">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tickets…"
              className="input-field pl-9 text-sm"
            />
          </div>
        </div>

        {/* Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  <th className="text-left text-xs font-medium text-slate-500 px-4 py-3 w-16">#</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-4 py-3 w-28">Code</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Image</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Title</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Price</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Visible</th>
                  <th className="text-right text-xs font-medium text-slate-500 px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                      {search ? `No results for "${search}"` : filter !== 'all' ? `No $${filter} tickets` : 'No tickets yet. Add one above.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-slate-700 text-xs w-16">
                        {item.number}
                      </td>
                      <td className="px-4 py-3 w-28">
                        {item.code ? (
                          <span className="font-mono text-xs font-semibold text-slate-800">{item.code}</span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="w-14 h-9 rounded-md overflow-hidden bg-slate-100 flex-shrink-0">
                          {item.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.image_url}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg className="w-4 h-4 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                              </svg>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-800 max-w-xs truncate">
                        {item.title || <span className="text-slate-400 italic text-xs">No title</span>}
                      </td>
                      <td className="px-4 py-3">
                        {item.price != null ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                            ${item.price}
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleEnabled(item)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                            item.enabled
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${item.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                          {item.enabled ? 'Visible' : 'Hidden'}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setModalItem(item)}
                            className="btn-secondary text-xs px-2.5 py-1.5"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(item)}
                            disabled={deleting === item.id}
                            className="btn-danger text-xs px-2.5 py-1.5"
                          >
                            {deleting === item.id ? '…' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Edit/Add modal */}
      {modalItem !== undefined && (
        <EditItemModal
          item={modalItem}
          onSave={handleSave}
          onClose={() => setModalItem(undefined)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-medium z-50 ${
            toast.type === 'success'
              ? 'bg-slate-900 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {toast.type === 'success' ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          )}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
