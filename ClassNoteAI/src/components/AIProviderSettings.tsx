/**
 * Settings UI for LLM providers.
 *
 * Lists the registered providers, lets the user paste a PAT / API key
 * per provider, and runs a smoke test against the provider's endpoint.
 * No functional wiring yet — the LLMProvider isn't called from anywhere
 * in the app until PR C/D. This just covers configuration.
 */

import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Loader2, Eye, EyeOff, ExternalLink } from 'lucide-react';
import {
  getProvider,
  keyStore,
  listProviders,
  LLMProviderDescriptor,
  LLMTestResult,
} from '../services/llm';

type ProviderState = {
  descriptor: LLMProviderDescriptor;
  value: string;
  saved: boolean;
  testing: boolean;
  result?: LLMTestResult;
  show: boolean;
};

const AUTH_FIELD_BY_PROVIDER: Record<string, string> = {
  'github-models': 'pat',
  anthropic: 'apiKey',
  openai: 'apiKey',
  gemini: 'apiKey',
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

export default function AIProviderSettings() {
  const [states, setStates] = useState<ProviderState[]>(() =>
    listProviders().map((d) => {
      const field = AUTH_FIELD_BY_PROVIDER[d.id];
      return {
        descriptor: d,
        value: (field && keyStore.get(d.id, field)) || '',
        saved: !!(field && keyStore.has(d.id, field)),
        testing: false,
        show: false,
      };
    })
  );
  const [defaultProvider, setDefaultProvider] = useState<string>(
    () => localStorage.getItem(DEFAULT_PROVIDER_KEY) || ''
  );

  useEffect(() => {
    if (defaultProvider) {
      localStorage.setItem(DEFAULT_PROVIDER_KEY, defaultProvider);
    } else {
      localStorage.removeItem(DEFAULT_PROVIDER_KEY);
    }
  }, [defaultProvider]);

  const updateState = (id: string, patch: Partial<ProviderState>) => {
    setStates((prev) => prev.map((s) => (s.descriptor.id === id ? { ...s, ...patch } : s)));
  };

  const onSave = (id: string) => {
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

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Default provider</label>
        <select
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          value={defaultProvider}
          onChange={(e) => setDefaultProvider(e.target.value)}
        >
          <option value="">(auto — first configured)</option>
          {states
            .filter((s) => s.saved)
            .map((s) => (
              <option key={s.descriptor.id} value={s.descriptor.id}>
                {s.descriptor.displayName}
              </option>
            ))}
        </select>
      </div>

      <div className="space-y-3">
        {states.map((s) => (
          <ProviderCard
            key={s.descriptor.id}
            state={s}
            help={HELP_LINKS[s.descriptor.id]}
            onChange={(v) => updateState(s.descriptor.id, { value: v })}
            onToggleShow={() => updateState(s.descriptor.id, { show: !s.show })}
            onSave={() => onSave(s.descriptor.id)}
            onTest={() => onTest(s.descriptor.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ProviderCard(props: {
  state: ProviderState;
  help?: { label: string; href: string };
  onChange: (v: string) => void;
  onToggleShow: () => void;
  onSave: () => void;
  onTest: () => void;
}) {
  const { state, help, onChange, onToggleShow, onSave, onTest } = props;
  const { descriptor, value, saved, testing, result, show } = state;
  const fieldLabel = descriptor.authType === 'pat' ? 'GitHub PAT' : 'API key';

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-slate-900/50">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="font-medium flex items-center gap-2">
            {descriptor.displayName}
            {saved && (
              <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
                configured
              </span>
            )}
          </div>
          {descriptor.notes && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{descriptor.notes}</div>
          )}
        </div>
      </div>

      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">{fieldLabel}</label>
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
          onClick={onSave}
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
