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

if (isWatch) {
  const extCtx = await esbuild.context(extensionConfig);
  const sidebarCtx = await esbuild.context(sidebarConfig);
  const dashboardCtx = await esbuild.context(dashboardConfig);
  await Promise.all([extCtx.watch(), sidebarCtx.watch(), dashboardCtx.watch()]);
  console.log('[esbuild] Watching for changes...');
} else {
  await Promise.all([
    esbuild.build(extensionConfig),
    esbuild.build(sidebarConfig),
    esbuild.build(dashboardConfig),
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
