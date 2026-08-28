import assert from 'node:assert/strict';
import test from 'node:test';
import { registerWebMcpTools } from './register.ts';
import { communityTools, curatorTools, sharedTools } from './tools.ts';

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

test('community surface registers exactly the nine community tools', () => withModelContext((registered) => {
  registerWebMcpTools('community');
  assert.equal(registered.length, 9);
  assert.deepEqual(registered.map((tool) => tool.name).sort(), communityTools.map((tool) => tool.name).sort());
}));

test('curator surface registers exactly the fifteen curator tools', () => withModelContext((registered) => {
  registerWebMcpTools('curator');
  assert.equal(registered.length, 15);
  assert.deepEqual(registered.map((tool) => tool.name).sort(), curatorTools.map((tool) => tool.name).sort());
}));

test('no curator-only tool is reachable from the community surface', () => withModelContext((registered) => {
  registerWebMcpTools('community');
  const names = new Set(registered.map((tool) => tool.name));
  const shared = new Set(sharedTools.map((tool) => tool.name));
  for (const tool of curatorTools) {
    if (shared.has(tool.name)) continue;
    assert.equal(names.has(tool.name), false, `${tool.name} leaked to community`);
  }
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
  assert.equal(held.size, communityTools.length);
  (globalThis as { document?: unknown }).document = previous;
});

test('a remount re-registers when the browser can unregister', () => withModelContext((registered) => {
  const cleanup = registerWebMcpTools('community');
  cleanup();
  registerWebMcpTools('community');
  assert.equal(registered.length, communityTools.length * 2, 'cleanup released the names, so re-registration is expected');
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
  assert.equal(attempts, curatorTools.length, 'every tool should still be attempted');
});

test('cleanup still aborts when the browser cannot unregister', () => {
  const previous = (globalThis as { document?: unknown }).document;
  const registered: string[] = [];
  (globalThis as { document?: unknown }).document = {
    modelContext: { registerTool: (spec: { name: string }) => registered.push(spec.name) },
  };
  const cleanup = registerWebMcpTools('community');
  assert.doesNotThrow(cleanup);
  assert.equal(registered.length, communityTools.length);
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
  assert.equal(registered.length, communityTools.length);
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

/* MCP-E8 — a no-op is the right behaviour and silence is not. Whoever is looking for
   the tools should be able to tell "this browser has no host API" from "registration
   failed", and the console is where they look. */
test('a browser with no model context says so instead of failing silently', () => {
  const globals = globalThis as { document?: unknown };
  const previousDocument = globals.document;
  const previousWarn = console.warn;
  const warnings: string[] = [];
  globals.document = {};
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  try {
    registerWebMcpTools('curator');
    assert.ok(warnings.some((line) => /modelContext/.test(line) && /no WebMCP tool was registered/i.test(line)), warnings.join(" | "));
    assert.ok(warnings.some((line) => line.includes('/api/tools/')), 'it should name the path that still works');
  } finally {
    globals.document = previousDocument;
    console.warn = previousWarn;
  }
});

/* G1 — the spec moved the getter from Navigator to Document, but a browser on the
   older shape must still work. */
/**
 * Node defines `navigator` as a getter with no setter, so a plain assignment is
 * silently dropped. It is configurable, so redefining it works.
 */
function setNavigator(value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete (globalThis as { navigator?: unknown }).navigator;
  };
}

function withLegacyNavigator(run: (registered: Registered[], warnings: string[]) => void) {
  const registered: Registered[] = [];
  const warnings: string[] = [];
  const globals = globalThis as { document?: unknown };
  const previousDocument = globals.document;
  const previousWarn = console.warn;
  globals.document = {};
  const restoreNavigator = setNavigator({ modelContext: { registerTool: (spec: Registered) => registered.push(spec) } });
  console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  try { run(registered, warnings); } finally {
    globals.document = previousDocument;
    restoreNavigator();
    console.warn = previousWarn;
  }
}

test('a legacy navigator.modelContext still receives the tools', () => withLegacyNavigator((registered) => {
  registerWebMcpTools('community');
  assert.equal(registered.length, communityTools.length);
}));

test('using the legacy navigator getter warns that it is deprecated', () => withLegacyNavigator((registered, warnings) => {
  registerWebMcpTools('community');
  assert.ok(warnings.some((line) => /deprecated/i.test(line) && /navigator\.modelContext/.test(line)), warnings.join(' | '));
}));

test('document.modelContext wins when a browser exposes both', () => {
  const onDocument: Registered[] = [];
  const onNavigator: Registered[] = [];
  const globals = globalThis as { document?: unknown };
  const previousDocument = globals.document;
  globals.document = { modelContext: { registerTool: (spec: Registered) => onDocument.push(spec) } };
  const restoreNavigator = setNavigator({ modelContext: { registerTool: (spec: Registered) => onNavigator.push(spec) } });
  try {
    registerWebMcpTools('community');
    assert.equal(onDocument.length, communityTools.length);
    assert.equal(onNavigator.length, 0);
  } finally {
    globals.document = previousDocument;
    restoreNavigator();
  }
});

/* G2 — the spec has no unregisterTool. An AbortSignal passed at registration is
   the only defined way to take a surface back. */
test('registration passes an abort signal the browser can honour', () => withModelContext((registered) => {
  registerWebMcpTools('curator');
  const withSignal = registered.filter((spec) => (spec as unknown as { signal?: AbortSignal }).signal instanceof AbortSignal);
  assert.equal(withSignal.length, registered.length, 'every tool should carry a signal');
}));

test('cleanup aborts the signal it registered with', () => withModelContext((registered) => {
  const cleanup = registerWebMcpTools('curator');
  const signals = registered.map((spec) => (spec as unknown as { signal: AbortSignal }).signal);
  assert.ok(signals.every((signal) => !signal.aborted), 'signals should start live');
  cleanup();
  assert.ok(signals.every((signal) => signal.aborted), 'cleanup should abort every signal');
}));

test('a surface aborted by cleanup can be registered again', () => withModelContext((registered) => {
  registerWebMcpTools('community')();
  const afterFirst = registered.length;
  registerWebMcpTools('community');
  assert.equal(registered.length, afterFirst * 2, 'an aborted surface is free to re-register');
}));

/* G6 — the schema budget the tool catalogue documents. */
test('every declared parameter describes itself', () => {
  const missing: string[] = [];
  for (const tool of [...communityTools, ...curatorTools]) {
    for (const [field, schema] of Object.entries(tool.properties ?? {})) {
      if (!(schema as { description?: string }).description) missing.push(`${tool.name}.${field}`);
    }
  }
  assert.deepEqual(missing, [], `parameters without a description: ${missing.join(', ')}`);
});

test('every required parameter is actually declared', () => {
  for (const tool of [...communityTools, ...curatorTools]) {
    for (const field of tool.required ?? []) {
      assert.ok(tool.properties?.[field], `${tool.name} requires ${field} but never declares it`);
    }
  }
});

/* FR-W1 put two asset read tools on both surfaces, because the same call must answer
   differently by role: a community agent sees only public, publicly-consented assets,
   a curator sees restricted ones too. `sharedTools` names that set in the catalogue,
   so the leak test above stays a real boundary check instead of quietly widening. */
test('the shared tools are the only ones on both surfaces', () => {
  const community = new Set(communityTools.map((tool) => tool.name));
  const onBoth = curatorTools.filter((tool) => community.has(tool.name)).map((tool) => tool.name).sort();
  assert.deepEqual(onBoth, sharedTools.map((tool) => tool.name).sort());
});

test('the community surface writes nothing beyond its own contributions', () => withModelContext((registered) => {
  registerWebMcpTools('community');
  const writers = registered.filter((tool) => tool.annotations?.readOnlyHint === false).map((tool) => tool.name).sort();
  assert.deepEqual(writers, ['attach_assets', 'submit_context_claim', 'submit_evidence']);
}));
