import assert from 'node:assert/strict';
import test from 'node:test';
import { registerWebMcpTools } from './register.ts';
import { communityTools, curatorTools } from './tools.ts';

type Registered = {
  name: string;
  description: string;
  inputSchema: { type: string; properties: Record<string, { description?: string }>; required: string[] };
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (args: unknown) => Promise<unknown>;
};

/** Stands in for the browser's WebMCP surface. */
function withModelContext(run: (registered: Registered[], unregistered: string[]) => void | Promise<void>) {
  const registered: Registered[] = [];
  const unregistered: string[] = [];
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    modelContext: {
      registerTool: (spec: Registered) => registered.push(spec),
      unregisterTool: (name: string) => unregistered.push(name),
    },
  };
  return Promise.resolve(run(registered, unregistered)).finally(() => {
    (globalThis as { document?: unknown }).document = previous;
  });
}

test('community surface registers exactly the six community tools', () => withModelContext((registered) => {
  registerWebMcpTools('community');
  assert.equal(registered.length, 6);
  assert.deepEqual(registered.map((tool) => tool.name).sort(), communityTools.map((tool) => tool.name).sort());
}));

test('curator surface registers exactly the twelve curator tools', () => withModelContext((registered) => {
  registerWebMcpTools('curator');
  assert.equal(registered.length, 12);
  assert.deepEqual(registered.map((tool) => tool.name).sort(), curatorTools.map((tool) => tool.name).sort());
}));

test('no curator tool is reachable from the community surface', () => withModelContext((registered) => {
  registerWebMcpTools('community');
  const names = new Set(registered.map((tool) => tool.name));
  for (const tool of curatorTools) assert.equal(names.has(tool.name), false, `${tool.name} leaked to community`);
}));

test('read tools are annotated read-only and write tools are not', () => withModelContext((registered) => {
  registerWebMcpTools('curator');
  const byName = new Map(registered.map((tool) => [tool.name, tool]));
  assert.equal(byName.get('list_submissions')?.annotations.readOnlyHint, true);
  assert.equal(byName.get('propose_label_update')?.annotations.readOnlyHint, false);
  assert.equal(byName.get('request_clarification')?.annotations.readOnlyHint, false);
}));

test('tools returning community material carry the external-content hint', () => withModelContext((registered) => {
  registerWebMcpTools('curator');
  const byName = new Map(registered.map((tool) => [tool.name, tool]));
  for (const name of ['list_submissions', 'get_review_case', 'compare_evidence', 'draft_label']) {
    assert.equal(byName.get(name)?.annotations.untrustedContentHint, true, `${name} must be flagged`);
  }
  assert.equal(byName.get('list_pending_approvals')?.annotations.untrustedContentHint, false);
}));

test('every tool declares an object schema and required fields it names', () => withModelContext((registered) => {
  registerWebMcpTools('curator');
  registerWebMcpTools('community');
  for (const tool of registered) {
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} schema`);
    for (const field of tool.inputSchema.required) {
      assert.ok(field in tool.inputSchema.properties, `${tool.name} requires undeclared field ${field}`);
    }
  }
}));

test('tool names and descriptions stay inside the documented limits', () => {
  for (const tool of [...communityTools, ...curatorTools]) {
    assert.ok(tool.name.length <= 30, `${tool.name} name is too long`);
    assert.ok(tool.description.length <= 500, `${tool.name} description is too long`);
    for (const [field, schema] of Object.entries(tool.properties ?? {})) {
      const description = (schema as { description?: string }).description;
      if (description) assert.ok(description.length <= 150, `${tool.name}.${field} description is too long`);
    }
  }
});

test('contribution tool descriptions state that submission does not change the record', () => {
  const submit = communityTools.find((tool) => tool.name === 'submit_evidence');
  assert.match(submit!.description, /does not change the public record/i);
  const propose = curatorTools.find((tool) => tool.name === 'propose_label_update');
  assert.match(propose!.description, /human approval/i);
});

test('execute posts the arguments to the tool endpoint and returns its JSON', () => withModelContext(async (registered) => {
  const calls: { url: string; body: string }[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    calls.push({ url: String(url), body: init.body });
    return { json: async () => ({ ok: true }) };
  }) as unknown as typeof fetch;

  registerWebMcpTools('community');
  const search = registered.find((tool) => tool.name === 'search_collection')!;
  const result = await search.execute({ query: 'mask' });

  globalThis.fetch = previousFetch;
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/tools/search_collection');
  assert.deepEqual(JSON.parse(calls[0].body), { query: 'mask' });
}));

test('the returned cleanup unregisters every tool it registered', () => withModelContext((registered, unregistered) => {
  const cleanup = registerWebMcpTools('curator');
  cleanup();
  assert.deepEqual(unregistered.sort(), registered.map((tool) => tool.name).sort());
}));

test('a remount does not re-register when the browser cannot unregister', () => {
  // Chrome exposes registerTool with no way to take a tool back, and a repeat
  // registration throws InvalidStateError: Duplicate tool name. The second
  // mount must skip instead.
  const previous = (globalThis as { document?: unknown }).document;
  const held = new Set<string>();
  (globalThis as { document?: unknown }).document = {
    modelContext: {
      registerTool: (spec: { name: string }) => {
        if (held.has(spec.name)) throw new DOMException('Duplicate tool name', 'InvalidStateError');
        held.add(spec.name);
      },
    },
  };

  registerWebMcpTools('community')();
  assert.doesNotThrow(() => registerWebMcpTools('community')());
  assert.equal(held.size, 6);
  (globalThis as { document?: unknown }).document = previous;
});

test('a remount re-registers when the browser can unregister', () => withModelContext((registered) => {
  const cleanup = registerWebMcpTools('community');
  cleanup();
  registerWebMcpTools('community');
  assert.equal(registered.length, 12, 'cleanup released the names, so re-registration is expected');
}));

test('a browser that rejects a tool never breaks the caller', () => {
  const previous = (globalThis as { document?: unknown }).document;
  let attempts = 0;
  (globalThis as { document?: unknown }).document = {
    modelContext: {
      registerTool: () => { attempts++; throw new DOMException('Duplicate tool name', 'InvalidStateError'); },
    },
  };
  const warn = console.warn;
  console.warn = () => {};
  assert.doesNotThrow(() => registerWebMcpTools('curator')());
  console.warn = warn;
  (globalThis as { document?: unknown }).document = previous;
  assert.equal(attempts, 12, 'every tool should still be attempted');
});

test('cleanup is a no-op when the browser cannot unregister', () => {
  const previous = (globalThis as { document?: unknown }).document;
  const registered: string[] = [];
  (globalThis as { document?: unknown }).document = {
    modelContext: { registerTool: (spec: { name: string }) => registered.push(spec.name) },
  };
  const cleanup = registerWebMcpTools('community');
  assert.doesNotThrow(cleanup);
  assert.equal(registered.length, 6);
  (globalThis as { document?: unknown }).document = previous;
});

test('an async getTools implementation is never treated as a list', () => {
  // Chrome returns a Promise here. Registration must not depend on it.
  const previous = (globalThis as { document?: unknown }).document;
  const registered: string[] = [];
  (globalThis as { document?: unknown }).document = {
    modelContext: {
      registerTool: (spec: { name: string }) => registered.push(spec.name),
      getTools: async () => [],
    },
  };
  assert.doesNotThrow(() => registerWebMcpTools('community'));
  assert.equal(registered.length, 6);
  (globalThis as { document?: unknown }).document = previous;
});

test('registration is a no-op when the browser exposes no model context', () => {
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {};
  const cleanup = registerWebMcpTools('curator');
  assert.equal(typeof cleanup, 'function');
  cleanup();
  (globalThis as { document?: unknown }).document = previous;
});
