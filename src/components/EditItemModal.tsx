'use client';

import { useState, FormEvent, useEffect, useRef } from 'react';
import type { LotteryItem, ItemFormData, PriceTier } from '@/types';
import { PRICE_TIERS } from '@/types';

interface EditItemModalProps {
  item?: LotteryItem | null;
  onSave: (data: ItemFormData, id?: string) => Promise<void>;
  onClose: () => void;
}

export default function EditItemModal({ item, onSave, onClose }: EditItemModalProps) {
  const [number, setNumber]     = useState(item?.number?.toString() ?? '');
  const [code, setCode]         = useState(item?.code ?? '');
  const [title, setTitle]       = useState(item?.title ?? '');
  const [imageUrl, setImageUrl] = useState(item?.image_url ?? '');
  const [price, setPrice]       = useState<PriceTier | null>(item?.price ?? null);
  const [enabled, setEnabled]   = useState(item?.enabled ?? true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const fileRef  = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const isEdit   = !!item;

  useEffect(() => {
    modalRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res  = await fetch('/api/admin/upload', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');
      setImageUrl(json.url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const num = parseInt(number, 10);
    if (!num || num < 1 || num > 9999) {
      setError('Item number must be between 1 and 9999');
      return;
    }
    setSaving(true);
    try {
      await onSave({ number: num, code: code.trim() || null, title, image_url: imageUrl || null, price, enabled }, item?.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div ref={modalRef} className="relative w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 id="modal-title" className="text-base font-semibold text-slate-900">
            {isEdit ? 'Edit Ticket' : 'Add Ticket'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Number + Visibility */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="item-number" className="block text-xs font-medium text-slate-700 mb-1.5">
                Sort # <span className="text-red-500">*</span>
              </label>
              <input
                id="item-number"
                data-autofocus=""
                type="number"
                min="1" max="9999"
                required
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                className="input-field font-mono"
                placeholder="1"
              />
            </div>
            <div>
              <label htmlFor="item-code" className="block text-xs font-medium text-slate-700 mb-1.5">
                Code
              </label>
              <input
                id="item-code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="input-field font-mono"
                placeholder="#2246"
                maxLength={20}
              />
            </div>
          </div>

          {/* Visibility */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled(!enabled)}
              className={`relative w-9 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 ${
                enabled ? 'bg-brand-600' : 'bg-slate-200'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${enabled ? 'translate-x-4' : ''}`} />
            </button>
            <span className="text-xs font-medium text-slate-700">Visible on display</span>
          </div>

          {/* Title */}
          <div>
            <label htmlFor="item-title" className="block text-xs font-medium text-slate-700 mb-1.5">
              Title
            </label>
            <input
              id="item-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input-field"
              placeholder="e.g. Lucky Star"
              maxLength={100}
            />
          </div>

          {/* Price tier */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-2">
              Price tier
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setPrice(null)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  price === null
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                }`}
              >
                None
              </button>
              {PRICE_TIERS.map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => setPrice(tier)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    price === tier
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                  }`}
                >
                  ${tier}
                </button>
              ))}
            </div>
          </div>

          {/* Image */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Ticket Image
            </label>
            <div className="space-y-2">
              {imageUrl && (
                <div className="relative w-full rounded-lg overflow-hidden bg-slate-100 border border-slate-200" style={{ aspectRatio: '5/3' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl} alt="Preview" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setImageUrl('')}
                    className="absolute top-2 right-2 w-6 h-6 bg-slate-900/60 hover:bg-slate-900/80 text-white rounded-full flex items-center justify-center"
                    aria-label="Remove image"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  className="input-field flex-1 text-xs"
                  placeholder="https://… or upload a file"
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  className="btn-secondary text-xs px-3 flex-shrink-0"
                >
                  {uploading ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 12 4.5c0 .933-.12 1.81-.338 2.64L4 12z" />
                    </svg>
                  ) : (
                    'Upload'
                  )}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
              <p className="text-xs text-slate-400">JPEG, PNG, WebP or GIF · Max 5 MB</p>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg">
              <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving || uploading} className="btn-primary flex-1">
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
