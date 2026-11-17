'use client';

/**
 * ConnectTVModal
 *
 * SESSION ISOLATION MODEL
 * -----------------------
 * The token for the current TV session is NEVER stored in localStorage.
 * On open, the modal calls GET /api/tv/session/mine which returns the
 * active session owned by the authenticated caller (Main Admin via Supabase
 * Auth, or Store Admin via store_admin_session cookie).  The server decides
 * which session belongs to this caller — the client never supplies a token
 * or store_id to the ownership check.
 *
 * This means:
 *   - Opening Store A's modal never reads Store B's token.
 *   - Main Admin and Store Admins each get their own session independently.
 *   - Multiple tabs cannot share or overwrite each other's tokens.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

interface Store {
  id: string;
  name: string;
}

interface SessionState {
  token: string;
  channelName: string;
  expiresAt: string;
  storeId: string | null;
}

interface PairingCodeState {
  code: string;
  expiresAt: string;
}

interface ConnectTVModalProps {
  onClose: () => void;
  /**
   * When set (Store Admin context), tells the modal it is operating on behalf
   * of this store.  Used only for UI display (store name in status row) and
   * to skip the Main Admin store-list fetch.  The server always derives the
   * actual store ownership from the cookie — this prop is never sent to the
   * server as a trust signal.
   */
  fixedStoreId?: string;
}

type SupabaseChannel = ReturnType<ReturnType<typeof createSupabaseBrowserClient>['channel']>;
type PresenceEntry   = { type?: string; [key: string]: unknown };

export default function ConnectTVModal({ onClose, fixedStoreId }: ConnectTVModalProps) {
  const [loading,       setLoading]       = useState(true);
  const [stores,        setStores]        = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [session,       setSession]       = useState<SessionState | null>(null);
  const [pairing,       setPairing]       = useState<PairingCodeState | null>(null);
  const [tvPresent,     setTVPresent]     = useState(false);
  const [displayActive, setDisplayActive] = useState(false);
  const [error,         setError]         = useState('');
  const [working,       setWorking]       = useState(false);
  const [countdown,     setCountdown]     = useState(0);

  const channelRef      = useRef<SupabaseChannel | null>(null);
  const countdownRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const displayActiveRef = useRef(displayActive);
  useEffect(() => { displayActiveRef.current = displayActive; }, [displayActive]);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function hoursRemaining(expiresAt: string): string {
    const diff    = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    const hours   = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `Expires in ${hours}h ${minutes}m`;
    return `Expires in ${minutes}m`;
  }

  function startCountdown(expiresAt: string) {
    if (countdownRef.current) clearInterval(countdownRef.current);
    const tick = () => {
      const secs = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setCountdown(secs);
      if (secs === 0) { clearInterval(countdownRef.current!); setPairing(null); }
    };
    tick();
    countdownRef.current = setInterval(tick, 1000);
  }

  function fmtCountdown(secs: number): string {
    return `${Math.floor(secs / 60).toString().padStart(2, '0')}:${(secs % 60).toString().padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------------------
  // Realtime channel
  // ---------------------------------------------------------------------------

  const teardownChannel = useCallback(() => {
    if (channelRef.current) {
      createSupabaseBrowserClient().removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  const subscribeToChannel = useCallback((channelName: string) => {
    teardownChannel();
    const ch = createSupabaseBrowserClient().channel(channelName);
    ch
      .on('presence', { event: 'sync' }, () => {
        const state     = ch.presenceState() as Record<string, PresenceEntry[]>;
        const connected = Object.values(state).some(ps => ps.some(p => p.type === 'tv'));
        setTVPresent(connected);
      })
      .on('broadcast', { event: 'tv-control' }, (payload: { payload: { action: string } }) => {
        if (payload.payload.action === 'start') setDisplayActive(true);
        else if (payload.payload.action === 'stop') setDisplayActive(false);
      })
      .subscribe();
    channelRef.current = ch;
  }, [teardownChannel]);

  // ---------------------------------------------------------------------------
  // On mount: fetch session from server (no localStorage involved)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Fetch stores list (Main Admin only — Store Admin context skips this)
      if (!fixedStoreId) {
        fetch('/api/admin/stores')
          .then(r => r.json() as Promise<{ data?: Store[] }>)
          .then(json => { if (!cancelled) setStores(json.data ?? []); })
          .catch(() => {});
      }

      // Fetch the active session owned by this authenticated caller from the server.
      // The server uses the caller's auth cookie — no token is supplied by the client.
      try {
        const url = fixedStoreId
          ? '/api/tv/session/mine'                                      // Store Admin — server uses cookie
          : `/api/tv/session/mine${selectedStoreId ? `?store_id=${selectedStoreId}` : ''}`;

        const res  = await fetch(url);
        const json = await res.json() as {
          session?: {
            token: string;
            channel_name: string;
            expires_at: string;
            display_state: boolean;
            store_id: string | null;
          } | null;
        };

        if (cancelled) return;

        if (json.session) {
          const s = json.session;
          setSession({ token: s.token, channelName: s.channel_name, expiresAt: s.expires_at, storeId: s.store_id });
          setDisplayActive(s.display_state);
          subscribeToChannel(s.channel_name);
        }
      } catch { /* no session or network error — show empty state */ }

      if (!cancelled) setLoading(false);
    }

    init();
    return () => {
      cancelled = true;
      teardownChannel();
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // runs once on mount

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function generateSession() {
    setWorking(true);
    setError('');
    try {
      // POST body carries store_id only for Main Admin store selection.
      // For Store Admin the server ignores any body store_id and uses the cookie.
      const body: Record<string, string> = {};
      if (!fixedStoreId && selectedStoreId) body.store_id = selectedStoreId;

      const res  = await fetch('/api/tv/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { token?: string; channel_name?: string; expires_at?: string; store_id?: string | null; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed to create session');

      const sess: SessionState = {
        token:       json.token!,
        channelName: json.channel_name!,
        expiresAt:   json.expires_at!,
        storeId:     json.store_id ?? null,
      };
      setSession(sess);
      setTVPresent(false);
      setDisplayActive(false);
      subscribeToChannel(sess.channelName);
      await generatePairingCode(sess.token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setWorking(false);
    }
  }

  async function generatePairingCode(sessionToken?: string) {
    const token = sessionToken ?? session?.token;
    if (!token) return;
    setWorking(true);
    setError('');
    try {
      const res  = await fetch('/api/tv/pair', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = await res.json() as { code?: string; expires_at?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed to generate code');
      setPairing({ code: json.code!, expiresAt: json.expires_at! });
      startCountdown(json.expires_at!);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate code');
    } finally {
      setWorking(false);
    }
  }

  async function rotateSession() {
    if (!session) return;
    setWorking(true);
    setError('');
    try {
      await fetch('/api/tv/session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: session.token }),
      });
      teardownChannel();
      setSession(null);
      setPairing(null);
      setTVPresent(false);
      setDisplayActive(false);
      if (countdownRef.current) clearInterval(countdownRef.current);
    } catch { /* best-effort revoke */ }
    await generateSession();
  }

  async function sendCommand(action: 'start' | 'stop') {
    if (!channelRef.current || !session) return;
    setWorking(true);
    try {
      // 1. Persist display_state server-side first (TV recovers from DB on reconnect)
      const patchRes = await fetch('/api/tv/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: session.token, display_state: action === 'start' }),
      });
      if (!patchRes.ok) throw new Error('Failed to persist display state');

      // 2. Broadcast to TV over Realtime
      await channelRef.current.send({
        type: 'broadcast',
        event: 'tv-control',
        payload: { action },
      });
      setDisplayActive(action === 'start');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send command');
    } finally {
      setWorking(false);
    }
  }

  const hasSession = !!session;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="tv-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <svg className="w-4 h-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
            </svg>
            <h2 id="tv-modal-title" className="text-base font-semibold text-slate-900">Connect to Store TV</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <svg className="w-6 h-6 text-slate-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}

          {/* No session */}
          {!loading && !hasSession && (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-900 mb-1">No active TV session</p>
              <p className="text-xs text-slate-500 mb-5 leading-relaxed">
                Open <span className="font-mono font-semibold text-slate-700">lotteryticket.vercel.app/tv</span> on the
                store TV, then click below to get a pairing code.
              </p>
              {/* Store selector — Main Admin only, never shown to Store Admin */}
              {!fixedStoreId && stores.length > 0 && (
                <div className="mb-4 text-left">
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Assign to store <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <select value={selectedStoreId} onChange={e => setSelectedStoreId(e.target.value)} className="input-field text-sm">
                    <option value="">— No store (unassigned) —</option>
                    {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              <button onClick={generateSession} disabled={working} className="btn-primary text-sm w-full">
                {working ? 'Setting up…' : 'Get pairing code'}
              </button>
            </div>
          )}

          {/* Session exists */}
          {!loading && hasSession && session && (
            <>
              {/* Status row */}
              <div className="flex items-center justify-between py-2.5 px-4 bg-slate-50 rounded-xl">
                <div className="flex items-center gap-2.5">
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${tvPresent ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <div>
                    <span className="text-sm text-slate-700 font-medium">
                      {tvPresent ? (displayActive ? 'TV connected · displaying' : 'TV connected · waiting') : 'TV not connected'}
                    </span>
                    {session.storeId && stores.length > 0 && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        {stores.find(s => s.id === session.storeId)?.name ?? 'Store'}
                      </p>
                    )}
                  </div>
                </div>
                <span className="text-xs text-slate-400">{hoursRemaining(session.expiresAt)}</span>
              </div>

              {/* TV not yet connected — show pairing code */}
              {!tvPresent && (
                <div className="text-center space-y-3">
                  <p className="text-xs text-slate-500 leading-relaxed">
                    On the store TV, open{' '}
                    <span className="font-mono font-semibold text-slate-700">lotteryticket.vercel.app/tv</span>{' '}
                    and enter this code:
                  </p>
                  {pairing && countdown > 0 ? (
                    <>
                      <div className="flex items-center justify-center gap-1.5 py-1" aria-label={`Pairing code: ${pairing.code}`}>
                        {pairing.code.split('').map((digit, i) => (
                          <span key={i} className="w-10 h-12 flex items-center justify-center rounded-lg bg-slate-900 text-white text-2xl font-bold font-mono">
                            {digit}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-slate-400">
                        Expires in{' '}
                        <span className={`font-mono font-semibold ${countdown <= 30 ? 'text-red-500' : 'text-slate-600'}`}>
                          {fmtCountdown(countdown)}
                        </span>
                      </p>
                      <button onClick={() => generatePairingCode()} disabled={working} className="text-xs text-slate-500 hover:text-slate-700 transition-colors underline underline-offset-2">
                        Generate new code
                      </button>
                    </>
                  ) : (
                    <button onClick={() => generatePairingCode()} disabled={working} className="btn-secondary text-sm w-full">
                      {working ? 'Generating…' : pairing ? 'Code expired — generate new code' : 'Generate pairing code'}
                    </button>
                  )}
                </div>
              )}

              {/* TV connected — start/stop controls */}
              {tvPresent && (
                <div className="flex gap-2">
                  <button onClick={() => sendCommand('start')} disabled={displayActive || working} className="btn-primary text-sm flex-1 disabled:opacity-40 disabled:cursor-not-allowed">
                    Start display
                  </button>
                  <button onClick={() => sendCommand('stop')} disabled={!displayActive || working} className="btn-secondary text-sm flex-1 disabled:opacity-40 disabled:cursor-not-allowed">
                    Stop display
                  </button>
                </div>
              )}

              {/* Rotate session */}
              <div className="pt-1 border-t border-slate-100">
                <button onClick={rotateSession} disabled={working} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
                  Unpair TV / generate new session
                </button>
              </div>
            </>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg">
              <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
