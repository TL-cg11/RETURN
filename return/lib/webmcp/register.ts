'use client';

import { toolsFor, type ToolSpec } from './tools.ts';

type ModelContext = {
  registerTool: (spec: unknown) => void;
  /** Not in the specification. Some builds still ship it; treat it as a bonus. */
  unregisterTool?: (name: string) => void;
};

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
  interface Navigator {
    modelContext?: ModelContext;
  }
}

/**
 * Names already handed to a given ModelContext.
 *
 * A repeat registration throws `InvalidStateError: Duplicate tool name`, and an
 * unguarded throw here escapes the mount effect and takes the surrounding React
 * commit with it, disabling the rest of the page. A name is released only when
 * the browser actually gave us a way to release it — aborting a signal is the
 * specified request, but nothing reports back whether the browser honoured it.
 */
const claimedBy = new WeakMap<ModelContext, Set<string>>();

function claimsFor(context: ModelContext) {
  let claimed = claimedBy.get(context);
  if (!claimed) { claimed = new Set(); claimedBy.set(context, claimed); }
  return claimed;
}

/**
 * The getter moved from `Navigator` to `Document` in the 2026-05-27 draft, and
 * `navigator.modelContext` is deprecated rather than gone. Prefer the current
 * position, accept the old one, and say so once when the old one is used.
 */
function resolveContext(): { context?: ModelContext; legacy: boolean } {
  if (typeof document !== 'undefined' && document.modelContext) {
    return { context: document.modelContext, legacy: false };
  }
  if (typeof navigator !== 'undefined' && navigator.modelContext) {
    return { context: navigator.modelContext, legacy: true };
  }
  return { legacy: false };
}

function specFor(tool: ToolSpec, signal: AbortSignal) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: { type: 'object', properties: tool.properties ?? {}, required: tool.required ?? [] },
    annotations: { readOnlyHint: tool.readOnly, untrustedContentHint: tool.untrusted ?? false },
    // The specification's only defined way to take a registration back.
    signal,
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
  const { context, legacy } = resolveContext();
  if (!context) return () => {};
  if (legacy) {
    console.warn('[RE:TURN] navigator.modelContext is deprecated; this browser should expose document.modelContext.');
  }

  const controller = new AbortController();
  const claimed = claimsFor(context);
  const added: string[] = [];
  for (const tool of toolsFor(role)) {
    if (claimed.has(tool.name)) continue;
    try {
      context.registerTool(specFor(tool, controller.signal));
      claimed.add(tool.name);
      added.push(tool.name);
    } catch (error) {
      console.warn(`[RE:TURN] WebMCP tool "${tool.name}" was not registered:`, error);
    }
  }

  return () => {
    // Abort first: it is what the specification defines, and a browser that
    // honours it has released the surface by the time we look at anything else.
    controller.abort();

    // Nothing reports whether the abort was honoured, so a name stays claimed
    // unless this browser also offers the older explicit release. Holding a name
    // costs one skipped registration; releasing one the browser still owns costs
    // a duplicate-name throw on the next mount.
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
