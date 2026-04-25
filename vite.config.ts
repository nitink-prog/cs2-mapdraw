import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const repositoryName = 'cs2-mapdraw'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // @ink:gotcha GitHub Pages serves project sites from /<repo>/, but Vite dev should stay rooted at /.
  base: command === 'build' ? `/${repositoryName}/` : '/',
  plugins: [react()],
}))
