'use client';

import { toolsFor } from './tools.ts';

declare global {
  interface Document {
    modelContext?: {
      registerTool: (spec: unknown) => void;
      unregisterTool?: (name: string) => void;
    };
  }
}

/**
 * Registers the tool surface for the current role. Community pages never
 * register curator tools; the server re-checks the role on every call, so
 * registration is a convenience, not the access boundary.
 */
export function registerWebMcpTools(role: 'community' | 'curator') {
  const context = typeof document === 'undefined' ? undefined : document.modelContext;
  if (!context) return () => {};
  const tools = toolsFor(role);

  tools.forEach((tool) => context.registerTool({
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
  }));

  return () => tools.forEach((tool) => context.unregisterTool?.(tool.name));
}
