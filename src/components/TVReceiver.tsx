'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { LotteryItem } from '@/types';
import DisplayBoard from '@/components/DisplayBoard';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

type TVState =
  | 'loading'
  | 'invalid_token'
  | 'expired_token'
  | 'revoked_token'
  | 'no_token'
  | 'waiting'
  | 'active'
  | 'reconnecting';

interface TVReceiverProps {
  token: string | null;
}

type SupabaseChannel = ReturnType<ReturnType<typeof createSupabaseBrowserClient>['channel']>;

export default function TVReceiver({ token }: TVReceiverProps) {
  const [tvState, setTVState] = useState<TVState>(token ? 'loading' : 'no_token');
  const [items, setItems] = useState<LotteryItem[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting'>('reconnecting');

  // Keep latest tvState accessible in async callbacks without stale closure
  const tvStateRef = useRef<TVState>(tvState);
  useEffect(() => { tvStateRef.current = tvState; }, [tvState]);

  const channelRef = useRef<SupabaseChannel | null>(null);

  // Fetch items from public API
  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/items');
      const json = await res.json() as { data?: LotteryItem[] };
      if (Array.isArray(json.data)) {
        setItems(json.data);
      }
    } catch (err) {
      console.error('[TVReceiver] fetchItems error', err);
    }
  }, []);

  // Poll items every 30 s
  useEffect(() => {
    fetchItems();
    const interval = setInterval(fetchItems, 30_000);
    return () => clearInterval(interval);
  }, [fetchItems]);

  // Validate token + subscribe to Realtime
  useEffect(() => {
    if (!token) {
      setTVState('no_token');
      return;
    }

    let cancelled = false;
    let channel: SupabaseChannel | null = null;

    async function init() {
      setTVState('loading');

      // 1. Validate token
      let channelName: string;
      try {
        const res = await fetch(`/api/tv/session?token=${encodeURIComponent(token!)}`);
        const json = await res.json() as { valid?: boolean; channel_name?: string; reason?: string };

        if (cancelled) return;

        if (!json.valid) {
          if (json.reason === 'expired') {
            setTVState('expired_token');
          } else if (json.reason === 'revoked') {
            setTVState('revoked_token');
          } else {
            setTVState('invalid_token');
          }
          return;
        }

        channelName = json.channel_name!;
      } catch (err) {
        console.error('[TVReceiver] token validation error', err);
        if (!cancelled) setTVState('invalid_token');
        return;
      }

      // 2. Subscribe to Realtime channel
      const supabase = createSupabaseBrowserClient();
      channel = supabase.channel(channelName);
      channelRef.current = channel;

      channel
        .on('broadcast', { event: 'tv-control' }, (payload: { payload: { action: string } }) => {
          if (payload.payload.action === 'start') {
            setTVState('active');
          } else if (payload.payload.action === 'stop') {
            setTVState('waiting');
          }
        })
        .on('presence', { event: 'sync' }, () => {
          // presence sync — TV stays in current display state
        })
        .subscribe(async (status: string) => {
          if (cancelled) return;

          if (status === 'SUBSCRIBED') {
            setConnectionStatus('connected');
            // Transition from loading/reconnecting to waiting (unless already active)
            if (tvStateRef.current === 'loading' || tvStateRef.current === 'reconnecting') {
              setTVState('waiting');
            }
            // Track TV presence on the channel
            try {
              await channel!.track({ type: 'tv', connected_at: new Date().toISOString() });
            } catch (trackErr) {
              console.error('[TVReceiver] presence track error', trackErr);
            }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setConnectionStatus('reconnecting');
            if (tvStateRef.current !== 'invalid_token' && tvStateRef.current !== 'expired_token') {
              setTVState('reconnecting');
            }
            setTimeout(() => {
              if (!cancelled && channel) channel.subscribe();
            }, 3000);
          }
        });
    }

    init();

    return () => {
      cancelled = true;
      if (channel) {
        const supabase = createSupabaseBrowserClient();
        supabase.removeChannel(channel);
      }
    };
  }, [token]);

  // --- Render states ---

  if (tvState === 'no_token') {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-white mb-3">TV Display Setup</h1>
          <p className="text-slate-400 text-sm leading-relaxed mb-6">
            This page is the store TV receiver. To set it up:
          </p>
          <ol className="text-left space-y-3 text-sm text-slate-300">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-700 text-slate-400 flex items-center justify-center text-xs font-bold">1</span>
              <span>Log in to the admin dashboard on your device.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-700 text-slate-400 flex items-center justify-center text-xs font-bold">2</span>
              <span>Click <strong className="text-white">&quot;Connect to Store TV&quot;</strong> in the header.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-700 text-slate-400 flex items-center justify-center text-xs font-bold">3</span>
              <span>Generate a pairing token and copy the TV URL shown.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-700 text-slate-400 flex items-center justify-center text-xs font-bold">4</span>
              <span>Open that URL on this TV. The display will appear.</span>
            </li>
          </ol>
        </div>
      </div>
    );
  }

  if (tvState === 'invalid_token') {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-full bg-red-900/50 flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-white mb-2">Invalid Pairing Token</h1>
          <p className="text-slate-400 text-sm">
            This token is not recognised. Ask the store owner to generate a new pairing token from the admin dashboard.
          </p>
        </div>
      </div>
    );
  }

  if (tvState === 'expired_token') {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-full bg-amber-900/50 flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-white mb-2">Pairing Token Expired</h1>
          <p className="text-slate-400 text-sm">
            This pairing token has expired (tokens last 24 hours). The store owner needs to generate a new one and update this TV&apos;s URL.
          </p>
        </div>
      </div>
    );
  }

  if (tvState === 'revoked_token') {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-full bg-amber-900/50 flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-white mb-2">Session Revoked</h1>
          <p className="text-slate-400 text-sm">
            This session has been revoked by the admin. Please obtain a new pairing token from the admin dashboard.
          </p>
        </div>
      </div>
    );
  }

  if (tvState === 'loading') {
    return (
      <div className="fixed inset-0 bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <svg className="w-8 h-8 text-slate-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-slate-500">Connecting&hellip;</p>
        </div>
      </div>
    );
  }

  // 'waiting', 'active', 'reconnecting' — render the full display area
  const isActive = tvState === 'active';
  const isReconnecting = tvState === 'reconnecting' || connectionStatus === 'reconnecting';

  return (
    <div className="fixed inset-0 bg-slate-900 overflow-hidden">
      {/* Waiting screen — fades out when active */}
      <div
        className="absolute inset-0 flex items-center justify-center transition-opacity duration-300"
        style={{ opacity: isActive ? 0 : 1, pointerEvents: isActive ? 'none' : 'auto' }}
        aria-hidden={isActive}
      >
        <div className="text-center px-8">
          {/* Logo */}
          <div className="w-16 h-16 rounded-2xl bg-brand-600 flex items-center justify-center mx-auto mb-6">
            <svg className="w-9 h-9 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
            </svg>
          </div>
          {/* Pulse indicator */}
          <div className="relative flex items-center justify-center mb-6">
            <span className="absolute w-10 h-10 rounded-full bg-emerald-500 opacity-20 animate-ping" />
            <span className="w-4 h-4 rounded-full bg-emerald-500" />
          </div>
          <h1 className="text-2xl font-semibold text-white mb-3">Waiting for connection&hellip;</h1>
          <p className="text-slate-400 text-sm max-w-xs mx-auto">
            This display is paired and ready. The store owner will start the display remotely.
          </p>
        </div>
      </div>

      {/* Active display — fades in when active */}
      <div
        className="absolute inset-0 bg-slate-50 overflow-auto transition-opacity duration-300"
        style={{ opacity: isActive ? 1 : 0, pointerEvents: isActive ? 'auto' : 'none' }}
        aria-hidden={!isActive}
      >
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <DisplayBoard initialItems={items} />
        </div>
      </div>

      {/* Reconnecting badge — shown when connection is lost during active/reconnecting states */}
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
