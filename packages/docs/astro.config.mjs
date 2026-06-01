import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  site: 'https://tonyblu331.github.io',
  base: '/okcolor',
  integrations: [
    starlight({
      title: 'okcolor',
      description: 'Zero-config build-time color modernizer for Vite and Tailwind CSS',
      logo: {
        src: './src/assets/hero.svg',
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/tonyblu331/okcolor' }],
      head: [
        {
          tag: 'meta',
          attrs: {
            property: 'og:image',
            content: 'https://tonyblu331.github.io/okcolor/og.png',
          },
        },
        {
          tag: 'meta',
          attrs: {
            name: 'twitter:image',
            content: 'https://tonyblu331.github.io/okcolor/og.png',
          },
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/tonyblu331/okcolor/edit/main/packages/docs/',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Overview', link: '/getting-started/' },
            { label: 'Vite Plugin', link: '/getting-started/vite/' },
            { label: 'CLI', link: '/getting-started/cli/' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Tailwind CSS v4', link: '/guides/tailwind/' },
            { label: 'Playground', link: '/guides/playground/' },
            { label: 'Live Converter', link: '/guides/converter/' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'API', link: '/reference/api/' },
            { label: 'Benchmarks', link: '/reference/benchmarks/' },
            { label: 'License', link: '/reference/license/' },
          ],
        },
      ],
      customCss: ['./src/styles/custom.css'],
      lastUpdated: true,
      pagination: true,
    }),
  ],
  output: 'static',
})
