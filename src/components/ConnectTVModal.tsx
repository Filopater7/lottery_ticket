'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const TV_BASE_URL = 'https://lotteryticket.vercel.app/tv';
const STORAGE_KEY = 'tv_session_token';

interface SessionState {
  token: string;
  channelName: string;
  expiresAt: string;
}

interface ConnectTVModalProps {
  onClose: () => void;
}

type SupabaseChannel = ReturnType<ReturnType<typeof createSupabaseBrowserClient>['channel']>;

type PresenceEntry = { type?: string; [key: string]: unknown };

export default function ConnectTVModal({ onClose }: ConnectTVModalProps) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionState | null>(null);
  const [tvPresent, setTVPresent] = useState(false);
  const [displayActive, setDisplayActive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  const channelRef = useRef<SupabaseChannel | null>(null);
  // Stable ref for displayActive to use inside callbacks
  const displayActiveRef = useRef(displayActive);
  useEffect(() => { displayActiveRef.current = displayActive; }, [displayActive]);

  const tvUrl = session ? `${TV_BASE_URL}?token=${session.token}` : '';

  // Calculate hours remaining
  function hoursRemaining(expiresAt: string): string {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return 'Expired';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `Expires in ${hours}h ${minutes}m`;
    return `Expires in ${minutes}m`;
  }

  // Tear down any existing channel subscription
  const teardownChannel = useCallback(() => {
    if (channelRef.current) {
      const supabase = createSupabaseBrowserClient();
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  // Subscribe to channel and track presence/commands
  const subscribeToChannel = useCallback((channelName: string) => {
    teardownChannel();

    const supabase = createSupabaseBrowserClient();
    const ch = supabase.channel(channelName);

    ch
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState() as Record<string, PresenceEntry[]>;
        const tvConnected = Object.values(state).some((presences) =>
          presences.some((p) => p.type === 'tv')
        );
        setTVPresent(tvConnected);
      })
      .on('broadcast', { event: 'tv-control' }, (payload: { payload: { action: string } }) => {
        const action = payload.payload.action;
        if (action === 'start') {
          setDisplayActive(true);
        } else if (action === 'stop') {
          setDisplayActive(false);
        }
      })
      .subscribe();

    channelRef.current = ch;
  }, [teardownChannel]);

  // Validate a stored token against the API
  const validateStoredToken = useCallback(async (token: string): Promise<SessionState | null> => {
    const res = await fetch(`/api/tv/session?token=${encodeURIComponent(token)}`);
    const json = await res.json() as { valid?: boolean; channel_name?: string; expires_at?: string };
    if (json.valid && json.channel_name && json.expires_at) {
      return { token, channelName: json.channel_name, expiresAt: json.expires_at };
    }
    return null;
  }, []);

  // On mount: check localStorage for existing session
  useEffect(() => {
    let cancelled = false;

    async function init() {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        if (!cancelled) setLoading(false);
        return;
      }

      try {
        const sess = await validateStoredToken(stored);
        if (cancelled) return;
        if (sess) {
          setSession(sess);
          subscribeToChannel(sess.channelName);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // ignore validation errors; treat as no session
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => {
      cancelled = true;
      teardownChannel();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once on mount

  // Generate a new pairing token
  async function generateToken() {
    setWorking(true);
    setError('');
    try {
      const res = await fetch('/api/tv/session', { method: 'POST' });
      const json = await res.json() as { token?: string; channel_name?: string; expires_at?: string; error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to create session');

      const sess: SessionState = {
        token: json.token!,
        channelName: json.channel_name!,
        expiresAt: json.expires_at!,
      };
      localStorage.setItem(STORAGE_KEY, sess.token);
      setSession(sess);
      setTVPresent(false);
      setDisplayActive(false);
      subscribeToChannel(sess.channelName);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate token');
    } finally {
      setWorking(false);
    }
  }

  // Revoke current session and generate a new one
  async function rotateToken() {
    if (!session) return;
    setWorking(true);
    setError('');
    try {
      // Revoke existing
      await fetch('/api/tv/session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: session.token }),
      });
      teardownChannel();
      setSession(null);
      setTVPresent(false);
      setDisplayActive(false);
      localStorage.removeItem(STORAGE_KEY);

      // Create new
      const res = await fetch('/api/tv/session', { method: 'POST' });
      const json = await res.json() as { token?: string; channel_name?: string; expires_at?: string; error?: string };
      if (!res.ok) throw new Error(json.error || 'Failed to create session');

      const sess: SessionState = {
        token: json.token!,
        channelName: json.channel_name!,
        expiresAt: json.expires_at!,
      };
      localStorage.setItem(STORAGE_KEY, sess.token);
      setSession(sess);
      subscribeToChannel(sess.channelName);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to rotate token');
    } finally {
      setWorking(false);
    }
  }

  // Send start/stop command via broadcast
  async function sendCommand(action: 'start' | 'stop') {
    if (!channelRef.current) return;
    setWorking(true);
    try {
      await channelRef.current.send({
        type: 'broadcast',
        event: 'tv-control',
        payload: { action },
      });
      if (action === 'start') {
        setDisplayActive(true);
      } else {
        setDisplayActive(false);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send command');
    } finally {
      setWorking(false);
    }
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(tvUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to clipboard');
    }
  }

  const hasSession = !!session;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="tv-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
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
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-900 mb-1">No active TV session</p>
              <p className="text-xs text-slate-500 mb-5">
                Generate a pairing token to link your store TV. Open the generated URL on your store TV browser once and it will stay connected.
              </p>
              <button
                onClick={generateToken}
                disabled={working}
                className="btn-primary text-sm w-full"
              >
                {working ? 'Generating\u2026' : 'Generate pairing token'}
              </button>
            </div>
          )}

          {/* Session exists */}
          {!loading && hasSession && session && (
            <>
              {/* TV URL */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">TV URL</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={tvUrl}
                    className="input-field flex-1 text-xs font-mono select-all"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    onClick={copyToClipboard}
                    className="btn-secondary text-xs px-3 flex-shrink-0"
                    title="Copy URL"
                  >
                    {copied ? (
                      <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.337c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Status row */}
              <div className="flex items-center justify-between py-3 px-4 bg-slate-50 rounded-xl">
                <div className="flex items-center gap-2.5">
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${tvPresent ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                  <span className="text-sm text-slate-700 font-medium">
                    {tvPresent
                      ? displayActive ? 'TV connected \u00b7 displaying' : 'TV connected \u00b7 waiting'
                      : 'TV not connected'}
                  </span>
                </div>
                <span className="text-xs text-slate-400">{hoursRemaining(session.expiresAt)}</span>
              </div>

              {/* Controls */}
              <div className="flex gap-2">
                <button
                  onClick={() => sendCommand('start')}
                  disabled={!tvPresent || displayActive || working}
                  className="btn-primary text-sm flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Start display
                </button>
                <button
                  onClick={() => sendCommand('stop')}
                  disabled={!displayActive || working}
                  className="btn-secondary text-sm flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Stop display
                </button>
              </div>

              {/* Generate new token */}
              <div className="pt-1 border-t border-slate-100">
                <button
                  onClick={rotateToken}
                  disabled={working}
                  className="text-xs text-slate-500 hover:text-slate-700 transition-colors"
                >
                  Generate new token (invalidates current)
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
