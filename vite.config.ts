import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** GitHub Pages serves at /<repo>/ — set BASE_PATH=/your-repo-name/ in CI (see .github/workflows). */
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
});
