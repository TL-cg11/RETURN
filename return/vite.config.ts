import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json';

const D1_DATABASE_NAME = 'return-museum';
const D1_DATABASE_ID = 'f4e676f8-afda-4a62-bd79-be51b6ffdcc3';

// Contribution and record assets (FR-D1). The binding is always present so the
// upload path behaves identically in local Miniflare and on Cloudflare.
//
// `return-assets` is the bucket this project deploys against, named to pair with the
// D1 database above. The override exists for a second account or a staging bucket,
// not because the name is undecided.
const MEDIA_BINDING = 'MEDIA';
const MEDIA_BUCKET_NAME = process.env.R2_ASSET_BUCKET ?? 'return-assets';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/app-router-entry',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: D1_DATABASE_NAME,
          database_id: D1_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: [
    { binding: MEDIA_BINDING, bucket_name: MEDIA_BUCKET_NAME },
    ...(r2 ? [{ binding: r2, bucket_name: 'site-creator-r2' }] : []),
  ],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
