import { describe, expect, it } from 'vitest';
import {
  collectAgentUiState,
  performAgentUiAction,
} from '../agentAutomationService';

describe('agentAutomationService', () => {
  it('collects stable renderer UI elements for the agent bridge', () => {
    document.body.innerHTML = `
      <main>
        <button data-agent-id="nav.settings">Settings</button>
        <input data-agent-id="search.box" aria-label="Search" value="CS" />
      </main>
    `;

    const state = collectAgentUiState(document);

    expect(state.schemaVersion).toBe(1);
    expect(state.source).toBe('renderer-dom');
    expect(state.elements.map((element) => element.id)).toEqual(
      expect.arrayContaining(['nav.settings', 'search.box']),
    );
    expect(state.elements.find((element) => element.id === 'search.box')?.value).toBe('CS');
  });

  it('clicks a target by data-agent-id', async () => {
    let clicked = false;
    document.body.innerHTML = '<button data-agent-id="nav.home">Home</button>';
    document.querySelector('button')?.addEventListener('click', () => {
      clicked = true;
    });

    const result = await performAgentUiAction({ actionId: 'a1', kind: 'click', target: 'nav.home' });

    expect(result.status).toBe('ok');
    expect(clicked).toBe(true);
  });

  it('types into inputs and dispatches change events', async () => {
    let changed = false;
    document.body.innerHTML = '<input data-agent-id="course.name" value="Old" />';
    document.querySelector('input')?.addEventListener('change', () => {
      changed = true;
    });

    const result = await performAgentUiAction({
      actionId: 'a2',
      kind: 'type',
      target: 'course.name',
      text: 'New',
      clear: true,
    });

    expect(result.status).toBe('ok');
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('New');
    expect(changed).toBe(true);
  });

  it('waits for text to appear in the document', async () => {
    setTimeout(() => {
      document.body.innerHTML = '<section>Ready</section>';
    }, 10);

    const result = await performAgentUiAction({
      actionId: 'a3',
      kind: 'wait-for',
      text: 'Ready',
      timeoutMs: 500,
    });

    expect(result.status).toBe('ok');
  });
});
