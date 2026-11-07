import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://jordanlang22.github.io',
  output: 'static',
  trailingSlash: 'ignore',
  build: { inlineStylesheets: 'auto' },
  devToolbar: { enabled: false },
});
