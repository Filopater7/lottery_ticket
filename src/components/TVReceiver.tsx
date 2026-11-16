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
// Fullscreen helpers — vendor-prefixed for Samsung/LG smart TV browsers
// ---------------------------------------------------------------------------

function fsRequest(el: Element): Promise<void> {
  const e = el as Element & {
    webkitRequestFullscreen?: () => Promise<void>;
    mozRequestFullScreen?: () => Promise<void>;
    msRequestFullscreen?: () => Promise<void>;
  };
  return (
    e.requestFullscreen?.()          ??
    e.webkitRequestFullscreen?.()    ??
    e.mozRequestFullScreen?.()       ??
    e.msRequestFullscreen?.()        ??
    Promise.resolve()
  );
}

function fsExit(): Promise<void> {
  const d = document as Document & {
    webkitExitFullscreen?: () => Promise<void>;
    mozCancelFullScreen?: () => Promise<void>;
    msExitFullscreen?: () => Promise<void>;
  };
  return (
    d.exitFullscreen?.()          ??
    d.webkitExitFullscreen?.()    ??
    d.mozCancelFullScreen?.()     ??
    d.msExitFullscreen?.()        ??
    Promise.resolve()
  );
}

function fsElement(): Element | null {
  const d = document as Document & {
    webkitFullscreenElement?: Element | null;
    mozFullScreenElement?: Element | null;
    msFullscreenElement?: Element | null;
  };
  return (
    d.fullscreenElement       ??
    d.webkitFullscreenElement ??
    d.mozFullScreenElement    ??
    d.msFullscreenElement     ??
    null
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TVReceiver() {
  const [tvState, setTVState]           = useState<TVState>('loading');
  const [items, setItems]               = useState<LotteryItem[]>([]);
  const [storeEmpty, setStoreEmpty]     = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting'>('reconnecting');
  const [pairError, setPairError]       = useState<PairError | null>(null);
  const [pin, setPin]                   = useState('');
  const [pinSubmitting, setPinSubmitting] = useState(false);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen]               = useState(false);
  // True when requestFullscreen() threw — browser needs a user gesture first
  const [needsGesture, setNeedsGesture]               = useState(false);

  const tvStateRef  = useRef<TVState>(tvState);
  const channelRef  = useRef<SupabaseChannel | null>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const rootRef     = useRef<HTMLDivElement>(null);  // fullscreen target
  const channelNameRef = useRef<string | null>(null);

  useEffect(() => { tvStateRef.current = tvState; }, [tvState]);

  // ---------------------------------------------------------------------------
  // Fullscreen management
  // ---------------------------------------------------------------------------

  // Track fullscreen state via browser events
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(!!fsElement());
      // If the user pressed Escape to exit fullscreen while display is active,
      // show the re-enter button so they can get back easily.
      if (!fsElement() && tvStateRef.current === 'active') {
        setNeedsGesture(true);
      }
    }
    document.addEventListener('fullscreenchange',       onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('mozfullscreenchange',    onFsChange);
    document.addEventListener('MSFullscreenChange',     onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange',       onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      document.removeEventListener('mozfullscreenchange',    onFsChange);
      document.removeEventListener('MSFullscreenChange',     onFsChange);
    };
  }, []);

  // Attempt fullscreen — called programmatically when active state is set.
  // Browsers block this unless triggered by a user gesture; we catch the
  // rejection and fall back to the manual button.
  const enterFullscreen = useCallback(async () => {
    if (!rootRef.current || fsElement()) return; // already fullscreen
    try {
      await fsRequest(rootRef.current);
      setNeedsGesture(false);
    } catch {
      // Browser blocked the automatic request (no prior user gesture).
      // Show the manual "Enter Fullscreen" button overlay.
      setNeedsGesture(true);
    }
  }, []);

  const exitFullscreen = useCallback(async () => {
    if (!fsElement()) return;
    try { await fsExit(); } catch { /* ignore */ }
  }, []);

  // React to tvState changes for fullscreen
  useEffect(() => {
    if (tvState === 'active') {
      enterFullscreen();
    } else if (tvState === 'waiting' || tvState === 'enter_code') {
      exitFullscreen();
      setNeedsGesture(false);
    }
  }, [tvState, enterFullscreen, exitFullscreen]);

  // ---------------------------------------------------------------------------
  // Items polling
  // ---------------------------------------------------------------------------

  const fetchItems = useCallback(async () => {
    try {
      const res  = await fetch('/api/items');
      const json = await res.json() as { data?: LotteryItem[]; empty_store?: boolean };
      if (json.empty_store) {
        setItems([]);
        setStoreEmpty(true);
        return;
      }
      setStoreEmpty(false);
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
  // Fetch persisted display_state from the server
  // ---------------------------------------------------------------------------

  const fetchDisplayState = useCallback(async (): Promise<boolean> => {
    try {
      const res  = await fetch('/api/tv/session');
      const json = await res.json() as { valid?: boolean; display_state?: boolean };
      if (json.valid) return json.display_state ?? false;
    } catch { /* keep current */ }
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
            const ds = await fetchDisplayState();
            setTVState(ds ? 'active' : 'waiting');
          }

          try {
            await ch.track({ type: 'tv', connected_at: new Date().toISOString() });
          } catch (e) {
            console.error('[TVReceiver] presence track error', e);
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConnectionStatus('reconnecting');
          const cur = tvStateRef.current;
          if (cur === 'waiting' || cur === 'active') setTVState('reconnecting');
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
      const params = new URLSearchParams(window.location.search);
      if (params.get('reset') === '1') {
        window.history.replaceState(null, '', window.location.pathname);
        if (!cancelled) setTVState('enter_code');
        return;
      }

      try {
        const res  = await fetch('/api/tv/session');
        const json = await res.json() as {
          valid?: boolean;
          channel_name?: string;
          display_state?: boolean;
        };
        if (cancelled) return;

        if (json.valid && json.channel_name) {
          subscribeToChannel(json.channel_name, json.display_state ?? false);
        } else {
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
  // PIN submission
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
        credentials: 'same-origin',
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

      subscribeToChannel(json.channel_name!, json.display_state ?? false);
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

  function unpair() {
    teardownChannel();
    exitFullscreen();
    setPin('');
    setPairError(null);
    setNeedsGesture(false);
    setTVState('enter_code');
  }

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
                <span key={i} className={`w-2 h-2 rounded-full transition-colors ${i < pin.length ? 'bg-brand-500' : 'bg-slate-700'}`} />
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
          <p className="text-xs text-slate-600 mt-4">Codes expire in 5 minutes and can only be used once.</p>
        </div>
      </div>
    );
  }

  // waiting / active / reconnecting
  const isActive       = tvState === 'active';
  const isReconnecting = tvState === 'reconnecting' || connectionStatus === 'reconnecting';

  return (
    // rootRef is the fullscreen target — the entire TV display surface
    <div ref={rootRef} className="fixed inset-0 bg-slate-900 overflow-hidden">

      {/* ── Waiting screen ───────────────────────────────────────────── */}
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

      {/* ── Active display ───────────────────────────────────────────── */}
      {/* TV-optimised: no max-width cap, tight padding, fills viewport    */}
      <div
        className="absolute inset-0 bg-slate-50 overflow-auto transition-opacity duration-300"
        style={{ opacity: isActive ? 1 : 0, pointerEvents: isActive ? 'auto' : 'none' }}
        aria-hidden={!isActive}
      >
        {/* Minimal top bar — brand only, no nav, no search header */}
        <div className="sticky top-0 z-10 bg-white/90 backdrop-blur-sm border-b border-slate-100 px-4 py-2 flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-brand-600 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-slate-700">Lottery Tickets</span>
        </div>
        <div className="px-3 py-3">
          {storeEmpty ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-5">
                <svg className="w-7 h-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
                </svg>
              </div>
              <p className="text-base font-medium text-slate-600 mb-2">No games selected for this store yet.</p>
              <p className="text-sm text-slate-400">Please contact your store administrator.</p>
            </div>
          ) : (
            <DisplayBoard initialItems={items} />
          )}
        </div>
      </div>

      {/* ── "Enter Fullscreen" gesture button ───────────────────────── */}
      {/* Shown when: display is active AND browser blocked auto-fullscreen */}
      {isActive && needsGesture && !isFullscreen && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <button
            onClick={() => {
              if (rootRef.current) {
                fsRequest(rootRef.current)
                  .then(() => setNeedsGesture(false))
                  .catch(() => { /* user declined or unsupported — dismiss overlay */ setNeedsGesture(false); });
              }
            }}
            className="flex flex-col items-center gap-4 group"
            aria-label="Enter fullscreen"
          >
            <div className="w-20 h-20 rounded-full bg-white/10 border-2 border-white/30 flex items-center justify-center group-hover:bg-white/20 transition-colors">
              {/* Expand icon */}
              <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            </div>
            <span className="text-white text-lg font-semibold">Tap to enter fullscreen</span>
            <span className="text-white/60 text-sm">Required once by the browser</span>
          </button>
        </div>
      )}

      {/* ── Reconnecting badge ───────────────────────────────────────── */}
      {isReconnecting && (tvState === 'active' || tvState === 'reconnecting') && (
        <div className="absolute top-4 right-4 z-30 flex items-center gap-2 bg-slate-800/90 text-slate-300 text-xs font-medium px-3 py-2 rounded-lg backdrop-blur-sm">
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
