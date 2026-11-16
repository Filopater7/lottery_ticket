'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { LotteryItem } from '@/types';
import DisplayBoard from '@/components/DisplayBoard';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TVState =
  | 'loading'       // checking cookie on mount
  | 'enter_code'    // no valid session cookie; show PIN entry form
  | 'pairing'       // submitting the code to the server
  | 'waiting'       // paired + subscribed, display_state = false
  | 'active'        // paired + subscribed, display_state = true
  | 'reconnecting'; // Realtime channel lost, re-subscribing

type PairError =
  | 'invalid_code'
  | 'expired_code'
  | 'used_code'
  | 'rate_limited'
  | 'server_error';

type SupabaseChannel = ReturnType<ReturnType<typeof createSupabaseBrowserClient>['channel']>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TVReceiver() {
  const [tvState, setTVState]           = useState<TVState>('loading');
  const [items, setItems]               = useState<LotteryItem[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting'>('reconnecting');
  const [pairError, setPairError]       = useState<PairError | null>(null);
  const [pin, setPin]                   = useState('');
  const [pinSubmitting, setPinSubmitting] = useState(false);

  const tvStateRef  = useRef<TVState>(tvState);
  const channelRef  = useRef<SupabaseChannel | null>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);
  // Stored after successful session validation; used to re-query display_state on reconnect
  const channelNameRef = useRef<string | null>(null);

  useEffect(() => { tvStateRef.current = tvState; }, [tvState]);

  // ---------------------------------------------------------------------------
  // Items polling
  // ---------------------------------------------------------------------------

  const fetchItems = useCallback(async () => {
    try {
      const res  = await fetch('/api/items');
      const json = await res.json() as { data?: LotteryItem[] };
      if (Array.isArray(json.data)) setItems(json.data);
    } catch (err) {
      console.error('[TVReceiver] fetchItems error', err);
    }
  }, []);

  useEffect(() => {
    fetchItems();
    const interval = setInterval(fetchItems, 30_000);
    return () => clearInterval(interval);
  }, [fetchItems]);

  // ---------------------------------------------------------------------------
  // Fetch persisted display_state from the server.
  // Called on mount (after cookie validation) and after every reconnect so the
  // TV recovers the correct screen even if it was offline when Start/Stop ran.
  // ---------------------------------------------------------------------------

  const fetchDisplayState = useCallback(async (): Promise<boolean> => {
    try {
      // GET /api/tv/session with no token param — server reads the HttpOnly cookie
      const res  = await fetch('/api/tv/session');
      const json = await res.json() as { valid?: boolean; display_state?: boolean };
      if (json.valid) return json.display_state ?? false;
    } catch {
      // network error — keep current state
    }
    return false;
  }, []);

  // ---------------------------------------------------------------------------
  // Realtime subscription
  // ---------------------------------------------------------------------------

  const teardownChannel = useCallback(() => {
    if (channelRef.current) {
      const supabase = createSupabaseBrowserClient();
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  const subscribeToChannel = useCallback((channelName: string, initialDisplayState: boolean) => {
    teardownChannel();
    channelNameRef.current = channelName;

    const supabase = createSupabaseBrowserClient();
    const ch = supabase.channel(channelName);
    channelRef.current = ch;

    ch
      .on('broadcast', { event: 'tv-control' }, (payload: { payload: { action: string } }) => {
        if (payload.payload.action === 'start') setTVState('active');
        else if (payload.payload.action === 'stop') setTVState('waiting');
      })
      .subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');

          const cur = tvStateRef.current;
          if (cur === 'loading' || cur === 'pairing' || cur === 'reconnecting') {
            // Re-read display_state from DB so we restore the correct screen
            // even if Start/Stop ran while the TV was offline.
            const ds = await fetchDisplayState();
            setTVState(ds ? 'active' : 'waiting');
          }

          // Track TV presence — independent of admin dashboard being open
          try {
            await ch.track({ type: 'tv', connected_at: new Date().toISOString() });
          } catch (e) {
            console.error('[TVReceiver] presence track error', e);
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConnectionStatus('reconnecting');
          const cur = tvStateRef.current;
          if (cur === 'waiting' || cur === 'active') setTVState('reconnecting');
          // Supabase client auto-retries; this is a belt-and-suspenders fallback
          setTimeout(() => { if (channelRef.current) channelRef.current.subscribe(); }, 3000);
        }
      });
  }, [teardownChannel, fetchDisplayState]);

  // ---------------------------------------------------------------------------
  // On mount: validate session via HttpOnly cookie, handle ?reset=1
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // ?reset=1 forces re-pairing by clearing the cookie server-side
      const params = new URLSearchParams(window.location.search);
      if (params.get('reset') === '1') {
        // Clear the cookie by calling DELETE (soft-revoke) is too destructive.
        // Instead just instruct the TV to re-pair; the cookie will be overwritten
        // when the new pairing code is exchanged.
        window.history.replaceState(null, '', window.location.pathname);
        // Skip cookie check — force enter_code
        if (!cancelled) setTVState('enter_code');
        return;
      }

      // Check whether the browser has a valid session cookie
      try {
        const res  = await fetch('/api/tv/session');
        const json = await res.json() as {
          valid?: boolean;
          channel_name?: string;
          display_state?: boolean;
          reason?: string;
        };
        if (cancelled) return;

        if (json.valid && json.channel_name) {
          subscribeToChannel(json.channel_name, json.display_state ?? false);
          // tvState set inside subscribe callback (after reading DB display_state)
        } else {
          // Cookie missing, revoked, or expired
          setTVState('enter_code');
        }
      } catch {
        if (!cancelled) setTVState('enter_code');
      }
    }

    init();
    return () => {
      cancelled = true;
      teardownChannel();
    };
  }, [subscribeToChannel, teardownChannel]);

  // Auto-focus PIN input
  useEffect(() => {
    if (tvState === 'enter_code' && pinInputRef.current) {
      pinInputRef.current.focus();
    }
  }, [tvState]);

  // ---------------------------------------------------------------------------
  // PIN submission — server sets the HttpOnly cookie on success
  // ---------------------------------------------------------------------------

  async function submitPin(codeToSubmit: string) {
    if (codeToSubmit.length !== 6) return;
    setPinSubmitting(true);
    setPairError(null);
    setTVState('pairing');

    try {
      const res  = await fetch('/api/tv/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: codeToSubmit }),
        credentials: 'same-origin', // ensure cookies are sent/received
      });
      const json = await res.json() as {
        channel_name?: string;
        display_state?: boolean;
        error?: string;
      };

      if (!res.ok) {
        let err: PairError = 'server_error';
        if (res.status === 429)      err = 'rate_limited';
        else if (res.status === 404) err = 'invalid_code';
        else if (res.status === 410) {
          err = json.error?.includes('used') ? 'used_code' : 'expired_code';
        }
        setPairError(err);
        setPin('');
        setTVState('enter_code');
        return;
      }

      // Cookie is now set by the server. Subscribe using the returned channel_name.
      subscribeToChannel(json.channel_name!, json.display_state ?? false);
      // tvState set inside subscribe callback
    } catch {
      setPairError('server_error');
      setPin('');
      setTVState('enter_code');
    } finally {
      setPinSubmitting(false);
    }
  }

  function handlePinChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
    setPin(val);
    if (val.length === 6) submitPin(val);
  }

  function handlePinKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && pin.length === 6) submitPin(pin);
  }

  // ---------------------------------------------------------------------------
  // Unpair — clears local state; cookie is overwritten on next successful pairing
  // ---------------------------------------------------------------------------

  function unpair() {
    teardownChannel();
    setPin('');
    setPairError(null);
    setTVState('enter_code');
  }

  // ---------------------------------------------------------------------------
  // Error messages
  // ---------------------------------------------------------------------------

  const pairErrorMessages: Record<PairError, string> = {
    invalid_code: "That code wasn't recognised. Check the code shown in the admin dashboard and try again.",
    expired_code: 'That code has expired. Ask the admin to generate a new one.',
    used_code:    'That code has already been used. Ask the admin to generate a new one.',
    rate_limited: 'Too many attempts. Please wait a few minutes before trying again.',
    server_error: 'Something went wrong. Please try again.',
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (tvState === 'loading' || tvState === 'pairing') {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <svg className="w-8 h-8 text-slate-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-slate-500">
            {tvState === 'pairing' ? 'Verifying code…' : 'Connecting…'}
          </p>
        </div>
      </div>
    );
  }

  if (tvState === 'enter_code') {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center p-8">
        <div className="text-center w-full max-w-xs">
          <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
            </svg>
          </div>

          <h1 className="text-xl font-semibold text-white mb-2">Enter Pairing Code</h1>
          <p className="text-slate-400 text-sm mb-6 leading-relaxed">
            Open the admin dashboard and click{' '}
            <strong className="text-slate-300">&ldquo;Connect to Store TV&rdquo;</strong>{' '}
            to get a 6-digit code.
          </p>

          <div className="relative mb-4">
            <input
              ref={pinInputRef}
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={pin}
              onChange={handlePinChange}
              onKeyDown={handlePinKeyDown}
              disabled={pinSubmitting}
              placeholder="000000"
              className="w-full text-center text-3xl font-bold font-mono tracking-[0.4em] bg-slate-800 text-white border-2 border-slate-700 focus:border-brand-500 focus:outline-none rounded-xl px-4 py-4 placeholder:text-slate-600 placeholder:tracking-[0.4em] transition-colors"
              aria-label="6-digit pairing code"
            />
            <div className="flex justify-center gap-2 mt-3">
              {Array.from({ length: 6 }, (_, i) => (
                <span
                  key={i}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i < pin.length ? 'bg-brand-500' : 'bg-slate-700'
                  }`}
                />
              ))}
            </div>
          </div>

          {pairError && (
            <div className="flex items-start gap-2 p-3 bg-red-900/30 border border-red-800/50 rounded-lg text-left mb-2">
              <svg className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-xs text-red-300 leading-relaxed">{pairErrorMessages[pairError]}</p>
            </div>
          )}

          <p className="text-xs text-slate-600 mt-4">
            Codes expire in 5 minutes and can only be used once.
          </p>
        </div>
      </div>
    );
  }

  const isActive       = tvState === 'active';
  const isReconnecting = tvState === 'reconnecting' || connectionStatus === 'reconnecting';

  return (
    <div className="fixed inset-0 bg-slate-900 overflow-hidden">
      {/* Waiting screen */}
      <div
        className="absolute inset-0 flex items-center justify-center transition-opacity duration-300"
        style={{ opacity: isActive ? 0 : 1, pointerEvents: isActive ? 'none' : 'auto' }}
        aria-hidden={isActive}
      >
        <div className="text-center px-8">
          <div className="w-16 h-16 rounded-2xl bg-brand-600 flex items-center justify-center mx-auto mb-6">
            <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
            </svg>
          </div>
          <div className="relative flex items-center justify-center mb-6">
            <span className="absolute w-10 h-10 rounded-full bg-emerald-500 opacity-20 animate-ping" />
            <span className="w-4 h-4 rounded-full bg-emerald-500" />
          </div>
          <h1 className="text-2xl font-semibold text-white mb-3">Waiting for connection&hellip;</h1>
          <p className="text-slate-400 text-sm max-w-xs mx-auto">
            This display is paired and ready. The store owner will start the display remotely.
          </p>
          <button
            onClick={unpair}
            className="mt-8 text-xs text-slate-600 hover:text-slate-400 transition-colors underline underline-offset-2"
          >
            Use a different pairing code
          </button>
        </div>
      </div>

      {/* Active display */}
      <div
        className="absolute inset-0 bg-slate-50 overflow-auto transition-opacity duration-300"
        style={{ opacity: isActive ? 1 : 0, pointerEvents: isActive ? 'auto' : 'none' }}
        aria-hidden={!isActive}
      >
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <DisplayBoard initialItems={items} />
        </div>
      </div>

      {/* Reconnecting badge */}
      {isReconnecting && (tvState === 'active' || tvState === 'reconnecting') && (
        <div className="absolute top-4 right-4 flex items-center gap-2 bg-slate-800/90 text-slate-300 text-xs font-medium px-3 py-2 rounded-lg backdrop-blur-sm">
          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Reconnecting&hellip;
        </div>
      )}
    </div>
  );
}
