/**
 * Settings UI for LLM providers.
 *
 * Two flavours of auth:
 *   - API key / PAT: password input + save.
 *   - OAuth: sign-in button that triggers the provider's `signIn()`.
 *     Shows an "unofficial channel" warning modal on first attempt.
 */

import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Loader2, Eye, EyeOff, ExternalLink, LogIn, LogOut } from 'lucide-react';
import {
  getProvider,
  keyStore,
  listProviders,
  LLMProviderDescriptor,
  LLMTestResult,
} from '../services/llm';
import type { ChatGPTOAuthProvider } from '../services/llm/providers/chatgpt-oauth';
import UnofficialChannelWarning from './UnofficialChannelWarning';

type ProviderState = {
  descriptor: LLMProviderDescriptor;
  value: string;
  saved: boolean;
  testing: boolean;
  signingIn: boolean;
  result?: LLMTestResult;
  show: boolean;
};

const AUTH_FIELD_BY_PROVIDER: Record<string, string> = {
  'github-models': 'pat',
  anthropic: 'apiKey',
  openai: 'apiKey',
  gemini: 'apiKey',
  // OAuth providers don't use a plain key field.
};

const HELP_LINKS: Record<string, { label: string; href: string }> = {
  'github-models': {
    label: 'Generate PAT (scope: models:read)',
    href: 'https://github.com/settings/tokens?type=beta',
  },
  anthropic: {
    label: 'Get API key from Anthropic console',
    href: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    label: 'Get API key from OpenAI platform',
    href: 'https://platform.openai.com/api-keys',
  },
  gemini: {
    label: 'Get API key from Google AI Studio',
    href: 'https://aistudio.google.com/apikey',
  },
};

const DEFAULT_PROVIDER_KEY = 'llm.defaultProvider';
const UNOFFICIAL_ACK_KEY = 'llm.unofficialAcknowledged';

function ackKey(providerId: string): string {
  return `${UNOFFICIAL_ACK_KEY}.${providerId}`;
}

export default function AIProviderSettings() {
  const [states, setStates] = useState<ProviderState[]>(() =>
    listProviders().map((d) => {
      const field = AUTH_FIELD_BY_PROVIDER[d.id];
      const savedKey = field ? keyStore.has(d.id, field) : false;
      const savedOAuth = d.authType === 'oauth' ? keyStore.has(d.id, 'accessToken') : false;
      return {
        descriptor: d,
        value: (field && keyStore.get(d.id, field)) || '',
        saved: savedKey || savedOAuth,
        testing: false,
        signingIn: false,
        show: false,
      };
    })
  );
  // Selected = default. We dropped the explicit "default provider" dropdown
  // in the v0.5.2 redesign — the UI now forces you to pick one provider at a
  // time via the card-picker, and that selection is persisted as the default.
  const [selectedProviderId, setSelectedProviderId] = useState<string>(() => {
    const saved = localStorage.getItem(DEFAULT_PROVIDER_KEY);
    const all = listProviders();
    if (saved && all.some((p) => p.id === saved)) return saved;
    // Pick first already-configured provider so users who upgrade from a
    // prior version land on whichever they had set up.
    const firstConfigured = all.find((d) => {
      const field = AUTH_FIELD_BY_PROVIDER[d.id];
      if (field && keyStore.has(d.id, field)) return true;
      if (d.authType === 'oauth' && keyStore.has(d.id, 'accessToken')) return true;
      return false;
    });
    return firstConfigured?.id ?? all[0]?.id ?? '';
  });
  const [pendingOAuthProvider, setPendingOAuthProvider] = useState<string | null>(null);

  useEffect(() => {
    if (selectedProviderId) {
      localStorage.setItem(DEFAULT_PROVIDER_KEY, selectedProviderId);
    } else {
      localStorage.removeItem(DEFAULT_PROVIDER_KEY);
    }
  }, [selectedProviderId]);

  const updateState = (id: string, patch: Partial<ProviderState>) => {
    setStates((prev) => prev.map((s) => (s.descriptor.id === id ? { ...s, ...patch } : s)));
  };

  const onSaveKey = (id: string) => {
    const field = AUTH_FIELD_BY_PROVIDER[id];
    const s = states.find((x) => x.descriptor.id === id);
    if (!field || !s) return;
    if (s.value.trim()) {
      keyStore.set(id, field, s.value.trim());
      updateState(id, { saved: true, result: undefined });
    } else {
      keyStore.clear(id, field);
      updateState(id, { saved: false, result: undefined });
    }
  };

  const onTest = async (id: string) => {
    updateState(id, { testing: true, result: undefined });
    try {
      const result = await getProvider(id).testConnection();
      updateState(id, { testing: false, result });
    } catch (err) {
      updateState(id, {
        testing: false,
        result: { ok: false, message: String(err) },
      });
    }
  };

  const onSignInClicked = (id: string) => {
    // Show the warning modal the first time this provider is used.
    const acknowledged = localStorage.getItem(ackKey(id)) === '1';
    if (!acknowledged) {
      setPendingOAuthProvider(id);
    } else {
      void runSignIn(id);
    }
  };

  const runSignIn = async (id: string) => {
    updateState(id, { signingIn: true, result: undefined });
    try {
      const provider = getProvider(id) as unknown as ChatGPTOAuthProvider;
      if (typeof provider.signIn !== 'function') {
        throw new Error('Provider does not support OAuth sign-in');
      }
      await provider.signIn();
      updateState(id, {
        signingIn: false,
        saved: true,
        result: { ok: true, message: 'Signed in successfully.' },
      });
    } catch (err) {
      updateState(id, {
        signingIn: false,
        result: { ok: false, message: String(err) },
      });
    }
  };

  const onSignOut = async (id: string) => {
    const provider = getProvider(id) as unknown as ChatGPTOAuthProvider;
    if (typeof provider.signOut === 'function') {
      await provider.signOut();
    }
    updateState(id, { saved: false, result: undefined });
  };

  const onCancelSignIn = async (id: string) => {
    const provider = getProvider(id) as unknown as ChatGPTOAuthProvider;
    if (typeof provider.cancelSignIn === 'function') {
      await provider.cancelSignIn();
    }
    // The runSignIn catch branch will flip signingIn=false once the invoke
    // promise rejects with "OAuth sign-in cancelled." — no need to force it.
  };

  const selected = states.find((s) => s.descriptor.id === selectedProviderId);

  return (
    <>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">服務提供商</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
            {states.map((s) => {
              const active = s.descriptor.id === selectedProviderId;
              return (
                <button
                  key={s.descriptor.id}
                  type="button"
                  onClick={() => setSelectedProviderId(s.descriptor.id)}
                  className={`relative px-3 py-3 rounded-lg border text-sm text-left transition ${
                    active
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-500/40'
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className="font-medium leading-tight">
                    {s.descriptor.displayName}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-[11px]">
                    {s.saved ? (
                      <span className="text-green-600 dark:text-green-400">
                        ● 已設定
                      </span>
                    ) : (
                      <span className="text-gray-400">○ 未設定</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            點選一個作為主要 LLM 提供商。被選中的就是摘要、Q&A、關鍵字預設使用的服務。
          </p>
        </div>

        {selected && (
          <ProviderCard
            state={selected}
            help={HELP_LINKS[selected.descriptor.id]}
            onChange={(v) => updateState(selected.descriptor.id, { value: v })}
            onToggleShow={() =>
              updateState(selected.descriptor.id, { show: !selected.show })
            }
            onSaveKey={() => onSaveKey(selected.descriptor.id)}
            onTest={() => onTest(selected.descriptor.id)}
            onSignIn={() => onSignInClicked(selected.descriptor.id)}
            onSignOut={() => onSignOut(selected.descriptor.id)}
            onCancelSignIn={() => onCancelSignIn(selected.descriptor.id)}
          />
        )}
      </div>

      {pendingOAuthProvider && (
        <UnofficialChannelWarning
          providerName={
            states.find((s) => s.descriptor.id === pendingOAuthProvider)?.descriptor.displayName ??
            pendingOAuthProvider
          }
          onCancel={() => setPendingOAuthProvider(null)}
          onContinue={() => {
            localStorage.setItem(ackKey(pendingOAuthProvider), '1');
            const id = pendingOAuthProvider;
            setPendingOAuthProvider(null);
            void runSignIn(id);
          }}
        />
      )}
    </>
  );
}

function ProviderCard(props: {
  state: ProviderState;
  help?: { label: string; href: string };
  onChange: (v: string) => void;
  onToggleShow: () => void;
  onSaveKey: () => void;
  onTest: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onCancelSignIn: () => void;
}) {
  const {
    state,
    help,
    onChange,
    onToggleShow,
    onSaveKey,
    onTest,
    onSignIn,
    onSignOut,
    onCancelSignIn,
  } = props;
  const { descriptor, value, saved, testing, signingIn, result, show } = state;
  const isOAuth = descriptor.authType === 'oauth';
  const fieldLabel = descriptor.authType === 'pat' ? 'GitHub PAT' : 'API key';

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-slate-900/50">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="font-medium flex items-center gap-2">
            {descriptor.displayName}
            {saved && (
              <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
                {isOAuth ? 'signed in' : 'configured'}
              </span>
            )}
            {isOAuth && (
              <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                unofficial
              </span>
            )}
          </div>
          {descriptor.notes && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{descriptor.notes}</div>
          )}
        </div>
      </div>

      {isOAuth ? (
        <div className="flex gap-2 items-center">
          {saved ? (
            <button
              type="button"
              onClick={onSignOut}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1.5"
            >
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          ) : signingIn ? (
            <>
              <button
                type="button"
                disabled
                className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white opacity-70 flex items-center gap-1.5 cursor-wait"
              >
                <Loader2 className="w-4 h-4 animate-spin" />
                等待瀏覽器授權…
              </button>
              <button
                type="button"
                onClick={onCancelSignIn}
                className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                title="瀏覽器頁面已關閉？按此取消並重試"
              >
                取消
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-1.5"
            >
              <LogIn className="w-4 h-4" />
              Sign in with ChatGPT
            </button>
          )}
          <button
            type="button"
            onClick={onTest}
            disabled={!saved || testing}
            className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Test
          </button>
        </div>
      ) : (
        <>
          <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
            {fieldLabel}
          </label>
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <input
                type={show ? 'text' : 'password'}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={descriptor.authType === 'pat' ? 'ghp_...' : 'sk-...'}
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-900 px-3 py-2 pr-10 text-sm font-mono"
              />
              <button
                type="button"
                onClick={onToggleShow}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                title={show ? 'Hide' : 'Show'}
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              type="button"
              onClick={onSaveKey}
              className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={onTest}
              disabled={!saved || testing}
              className="px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {testing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Test
            </button>
          </div>
        </>
      )}

      {help && (
        <a
          href={help.href}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-2 inline-flex items-center gap-1"
        >
          {help.label}
          <ExternalLink className="w-3 h-3" />
        </a>
      )}

      {result && (
        <div
          className={`mt-2 text-xs flex items-start gap-1.5 ${
            result.ok
              ? 'text-green-700 dark:text-green-400'
              : 'text-red-700 dark:text-red-400'
          }`}
        >
          {result.ok ? (
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          ) : (
            <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          )}
          <span className="break-all">{result.message}</span>
        </div>
      )}
    </div>
  );
}
