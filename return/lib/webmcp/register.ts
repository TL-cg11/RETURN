'use client';

import { toolsFor, type ToolSpec } from './tools.ts';

type ModelContext = {
  registerTool: (spec: unknown) => void;
  /** Chrome does not implement this yet; a registered tool cannot be taken back. */
  unregisterTool?: (name: string) => void;
};

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

/**
 * Names already handed to a given ModelContext. Chrome's current implementation
 * exposes `registerTool` but no way to take a tool back, and a repeat
 * registration throws `InvalidStateError: Duplicate tool name`. Left unguarded
 * that exception escapes the mount effect and takes the surrounding React
 * commit down with it, which disables the rest of the page.
 */
const claimedBy = new WeakMap<ModelContext, Set<string>>();

function claimsFor(context: ModelContext) {
  let claimed = claimedBy.get(context);
  if (!claimed) { claimed = new Set(); claimedBy.set(context, claimed); }
  return claimed;
}

/**
 * `getTools()` is async in Chrome, so it cannot answer this question during a
 * mount. The per-context claim set is the synchronous record instead; it is
 * accurate because a fresh document always gets a fresh ModelContext.
 */
function alreadyRegistered(context: ModelContext, name: string) {
  return claimsFor(context).has(name);
}

function specFor(tool: ToolSpec) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: { type: 'object', properties: tool.properties ?? {}, required: tool.required ?? [] },
    annotations: { readOnlyHint: tool.readOnly, untrustedContentHint: tool.untrusted ?? false },
    execute: async (args: unknown) => {
      const response = await fetch(`/api/tools/${tool.name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args ?? {}),
      });
      return response.json();
    },
  };
}

/**
 * Registers the tool surface for the current role. Community pages never
 * register curator tools; the server re-checks the role on every call, so
 * registration is a convenience, not the access boundary.
 *
 * Registration never throws: a browser that rejects a tool loses that tool,
 * not the page.
 */
export function registerWebMcpTools(role: 'community' | 'curator') {
  const context = typeof document === 'undefined' ? undefined : document.modelContext;
  if (!context) return () => {};

  const claimed = claimsFor(context);
  const added: string[] = [];
  for (const tool of toolsFor(role)) {
    if (alreadyRegistered(context, tool.name)) continue;
    try {
      context.registerTool(specFor(tool));
      claimed.add(tool.name);
      added.push(tool.name);
    } catch (error) {
      console.warn(`[RE:TURN] WebMCP tool "${tool.name}" was not registered:`, error);
    }
  }

  return () => {
    const unregister = context.unregisterTool;
    if (typeof unregister !== 'function') return;
    for (const name of added) {
      try {
        unregister.call(context, name);
        claimed.delete(name);
      } catch {
        // The browser kept the tool; leave it claimed so we never re-register it.
      }
    }
  };
}
