import { defineConfig } from 'vitest/config'

// Kept separate from vite.config.ts rather than merged into it: vitest's own bundled Vite
// (a peer range behind this project's own vite version) has an incompatible `Plugin` type, so
// pulling @vitejs/plugin-react's `react()` into a shared config trips a type error - tests here
// are plain Node-environment unit tests and don't need the React plugin at all.
export default defineConfig({
  test: {
    environment: 'node',
  },
})
