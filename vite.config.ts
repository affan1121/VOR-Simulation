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
}));
