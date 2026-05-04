import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useEffect } from 'react';

const UI_ACTION_EVENT = 'agent-bridge-ui-action';
const UPDATE_COMMAND = 'agent_bridge_update_ui_state';
const COMPLETE_COMMAND = 'agent_bridge_complete_ui_action';
const INTERACTIVE_SELECTOR = [
  '[data-agent-id]',
  'button',
  'input',
  'textarea',
  'select',
  'a[href]',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[contenteditable="true"]',
].join(',');

type AgentBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AgentUiElement = {
  id: string;
  role: string;
  tag: string;
  text: string;
  label: string | null;
  enabled: boolean;
  visible: boolean;
  bounds: AgentBounds;
  selector: string;
  value?: string;
  attributes: Record<string, string>;
};

export type AgentUiState = {
  schemaVersion: 1;
  type: 'ui_tree';
  source: 'renderer-dom';
  capturedAt: string;
  location: {
    path: string;
    search: string;
    hash: string;
  };
  title: string;
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
  };
  focus: {
    id: string | null;
    text: string;
    tag: string | null;
  };
  elements: AgentUiElement[];
  tree: {
    role: 'application';
    label: string;
    children: AgentUiElement[];
  };
};

type AgentUiAction = {
  actionId: string;
  kind: 'click' | 'type' | 'key' | 'navigate' | 'wait-for';
  target?: string;
  selector?: string;
  text?: string;
  path?: string;
  key?: string;
  clear?: boolean;
  timeoutMs?: number;
};

type AgentActionResult = {
  status: 'ok' | 'failed' | 'timeout';
  message?: string;
  state?: AgentUiState;
};

const autoIds = new WeakMap<Element, string>();

export function collectAgentUiState(doc: Document = document): AgentUiState {
  const elements = Array.from(doc.querySelectorAll(INTERACTIVE_SELECTOR))
    .filter((element) => element instanceof HTMLElement)
    .map((element, index) => describeElement(element as HTMLElement, index));
  const active = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  const activeId = active ? getAgentId(active, 0) : null;

  return {
    schemaVersion: 1,
    type: 'ui_tree',
    source: 'renderer-dom',
    capturedAt: new Date().toISOString(),
    location: {
      path: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    },
    title: doc.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
    focus: {
      id: activeId,
      text: active ? normalizeText(active.innerText || active.textContent || '') : '',
      tag: active?.tagName.toLowerCase() ?? null,
    },
    elements,
    tree: {
      role: 'application',
      label: doc.title || 'ClassNoteAI',
      children: elements,
    },
  };
}

export async function performAgentUiAction(action: AgentUiAction, doc: Document = document): Promise<AgentActionResult> {
  try {
    if (action.kind === 'navigate') {
      const path = action.path || action.text;
      if (!path) {
        return failed('navigate requires --path');
      }
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
      return ok(doc);
    }

    if (action.kind === 'wait-for') {
      return waitForAction(action, doc);
    }

    if (action.kind === 'key') {
      const key = action.key || action.text;
      if (!key) {
        return failed('key requires --key');
      }
      dispatchKeyboard(key, doc.activeElement || doc.body);
      return ok(doc);
    }

    const target = findTarget(action, doc);
    if (!target) {
      return failed(`target not found: ${action.target || action.selector || ''}`);
    }

    if (action.kind === 'click') {
      if (isDisabled(target as HTMLElement)) {
        return failed(`target is disabled: ${action.target || action.selector || ''}`);
      }
      (target as HTMLElement).click();
      return ok(doc);
    }

    if (action.kind === 'type') {
      if (action.text == null) {
        return failed('type requires --text');
      }
      setElementText(target as HTMLElement, action.text, Boolean(action.clear));
      return ok(doc);
    }

    return failed(`unsupported action: ${action.kind}`);
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}

export function useAgentAutomationBridge() {
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    let mutationObserver: MutationObserver | undefined;
    let updateTimer: number | undefined;

    const updateState = () => {
      if (disposed) return;
      window.clearTimeout(updateTimer);
      updateTimer = window.setTimeout(() => {
        void invoke(UPDATE_COMMAND, { state: collectAgentUiState() }).catch(() => {
          // Bridge commands only exist in the desktop runtime and only matter
          // when the opt-in agent bridge is active.
        });
      }, 80);
    };

    void listen<AgentUiAction>(UI_ACTION_EVENT, async (event) => {
      const action = event.payload;
      const result = await performAgentUiAction(action);
      const actionId = action?.actionId;
      if (!actionId) return;
      await invoke(COMPLETE_COMMAND, {
        actionId,
        result,
      }).catch(() => undefined);
      updateState();
    }).then((dispose) => {
      unlisten = dispose;
    }).catch(() => undefined);

    updateState();
    mutationObserver = new MutationObserver(updateState);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'disabled', 'aria-label', 'data-agent-id'],
    });
    window.addEventListener('popstate', updateState);
    window.addEventListener('focusin', updateState);
    window.addEventListener('resize', updateState);

    return () => {
      disposed = true;
      window.clearTimeout(updateTimer);
      mutationObserver?.disconnect();
      window.removeEventListener('popstate', updateState);
      window.removeEventListener('focusin', updateState);
      window.removeEventListener('resize', updateState);
      unlisten?.();
    };
  }, []);
}

function describeElement(element: HTMLElement, index: number): AgentUiElement {
  const rect = element.getBoundingClientRect();
  const text = normalizeText(element.innerText || element.textContent || '');
  const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
    ? (element.type === 'password' ? '' : element.value)
    : undefined;
  const label = element.getAttribute('aria-label') || element.getAttribute('title') || value || text || null;
  const id = getAgentId(element, index);

  return {
    id,
    role: element.getAttribute('role') || inferRole(element),
    tag: element.tagName.toLowerCase(),
    text,
    label,
    enabled: !isDisabled(element),
    visible: isVisible(element),
    bounds: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    selector: selectorFor(element, id),
    ...(value !== undefined ? { value } : {}),
    attributes: {
      ...(element.id ? { id: element.id } : {}),
      ...(element.getAttribute('data-agent-id') ? { agentId: element.getAttribute('data-agent-id') || '' } : {}),
      ...(element.getAttribute('aria-label') ? { ariaLabel: element.getAttribute('aria-label') || '' } : {}),
      ...(element.getAttribute('type') ? { type: element.getAttribute('type') || '' } : {}),
    },
  };
}

function getAgentId(element: Element, index: number): string {
  const explicit = element.getAttribute('data-agent-id');
  if (explicit) return explicit;
  const existing = autoIds.get(element);
  if (existing) return existing;
  const tag = element.tagName.toLowerCase();
  const label = normalizeText(
    element.getAttribute('aria-label')
    || element.getAttribute('title')
    || element.textContent
    || '',
  ).slice(0, 32).replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '').toLowerCase();
  const id = `auto:${tag}:${index}${label ? `:${label}` : ''}`;
  autoIds.set(element, id);
  element.setAttribute('data-agent-auto-id', id);
  return id;
}

function selectorFor(element: Element, id: string): string {
  const explicit = element.getAttribute('data-agent-id');
  if (explicit) return `[data-agent-id="${cssEscape(explicit)}"]`;
  if (element.id) return `#${cssEscape(element.id)}`;
  return `[data-agent-auto-id="${cssEscape(id)}"]`;
}

function findTarget(action: AgentUiAction, doc: Document): Element | null {
  if (action.selector) {
    try {
      return doc.querySelector(action.selector);
    } catch {
      return null;
    }
  }
  if (!action.target) return null;
  const explicit = doc.querySelector(`[data-agent-id="${cssEscape(action.target)}"]`);
  if (explicit) return explicit;
  return collectAgentUiState(doc).elements.find((element) => element.id === action.target)
    ? Array.from(doc.querySelectorAll(INTERACTIVE_SELECTOR)).find((element, index) => getAgentId(element, index) === action.target) || null
    : null;
}

function setElementText(element: HTMLElement, text: string, clear: boolean) {
  element.focus();
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const nextValue = clear ? text : `${element.value}${text}`;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
    if (setter) {
      setter.call(element, nextValue);
    } else {
      element.value = nextValue;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (element.isContentEditable) {
    if (clear) element.textContent = '';
    document.execCommand?.('insertText', false, text);
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }
}

async function waitForAction(action: AgentUiAction, doc: Document): Promise<AgentActionResult> {
  const timeoutMs = Math.max(1, action.timeoutMs || 5000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (action.target && findTarget(action, doc)) return ok(doc);
    if (action.selector && findTarget(action, doc)) return ok(doc);
    if (action.text && normalizeText(doc.body.innerText || doc.body.textContent || '').includes(action.text)) {
      return ok(doc);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
  return { status: 'timeout', message: 'wait-for timed out', state: collectAgentUiState(doc) };
}

function dispatchKeyboard(key: string, target: Element) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

function ok(doc: Document): AgentActionResult {
  return { status: 'ok', state: collectAgentUiState(doc) };
}

function failed(message: string): AgentActionResult {
  return { status: 'failed', message };
}

function inferRole(element: HTMLElement): string {
  const tag = element.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'input' || tag === 'textarea') return 'textbox';
  if (tag === 'select') return 'combobox';
  return 'generic';
}

function isDisabled(element: HTMLElement): boolean {
  return Boolean((element as HTMLButtonElement | HTMLInputElement).disabled || element.getAttribute('aria-disabled') === 'true');
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/gu, '\\$&');
}
