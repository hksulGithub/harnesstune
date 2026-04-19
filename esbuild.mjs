import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';

const isWatch = process.argv.includes('--watch');

// Extension host bundle (CJS, Node.js, external vscode)
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode', 'sql.js'],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  minify: false,
};

// Sidebar webview bundle (ESM, browser)
const sidebarConfig = {
  entryPoints: ['src/webview/sidebar/index.tsx'],
  bundle: true,
  outfile: 'dist/webview/sidebar.js',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: false,
  define: { 'process.env.NODE_ENV': '"development"' },
};

// Dashboard webview bundle (ESM, browser)
const dashboardConfig = {
  entryPoints: ['src/webview/dashboard/index.tsx'],
  bundle: true,
  outfile: 'dist/webview/dashboard.js',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: false,
  define: { 'process.env.NODE_ENV': '"development"' },
};

// Schematic webview bundle (ESM, browser)
const schematicConfig = {
  entryPoints: ['src/webview/schematic/index.tsx'],
  bundle: true,
  outfile: 'dist/webview/schematic.js',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: false,
  define: { 'process.env.NODE_ENV': '"development"' },
};

// Chat webview bundle (ESM, browser)
const chatConfig = {
  entryPoints: ['src/webview/chat/index.tsx'],
  bundle: true,
  outfile: 'dist/webview/chat.js',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: false,
  define: { 'process.env.NODE_ENV': '"development"' },
};

if (isWatch) {
  const extCtx = await esbuild.context(extensionConfig);
  const sidebarCtx = await esbuild.context(sidebarConfig);
  const dashboardCtx = await esbuild.context(dashboardConfig);
  const schematicCtx = await esbuild.context(schematicConfig);
  const chatCtx = await esbuild.context(chatConfig);
  await Promise.all([extCtx.watch(), sidebarCtx.watch(), dashboardCtx.watch(), schematicCtx.watch(), chatCtx.watch()]);
  console.log('[esbuild] Watching for changes...');
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(sidebarConfig),
    esbuild.build(dashboardConfig),
    esbuild.build(schematicConfig),
    esbuild.build(chatConfig),
  ]);
  console.log('[esbuild] Build complete.');

  // Copy sql.js WASM binary to dist/ for runtime resolution
  try {
    mkdirSync('dist', { recursive: true });
    copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm', 'dist/sql-wasm.wasm');
    console.log('[esbuild] sql-wasm.wasm copied to dist/');
  } catch (e) {
    console.warn('[esbuild] sql-wasm.wasm copy skipped:', e.message);
  }
}
