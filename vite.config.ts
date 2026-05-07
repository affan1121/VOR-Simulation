import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * GitHub Pages serves the site at https://user.github.io/<repo>/.
 * A relative base in production makes JS/CSS load from that folder even when
 * the GitHub repo name differs from your local project folder name.
 */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/',
  plugins: [react()],
  /**
   * Some setups (network mounts, certain editors, sandboxed filesystems) don't deliver
   * native FS events reliably to Vite's chokidar watcher, which leaves the dev server
   * serving stale modules after edits. Polling fixes that — modest CPU cost, but
   * guarantees HMR sees every save.
   */
  server: {
    watch: {
      usePolling: true,
      interval: 250,
    },
  },
}));
