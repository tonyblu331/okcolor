import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

export default defineConfig({
  site: 'https://ok-actually.github.io',
  base: '/ok-actually',
  integrations: [
    starlight({
      title: 'ok-actually',
      description: 'Zero-config build-time color modernizer for Vite and Tailwind CSS',
      logo: {
        src: './src/assets/hero.svg',
      },
      social: {
        github: 'https://github.com/ok-actually/ok-actually',
      },
      editLink: {
        baseUrl: 'https://github.com/ok-actually/ok-actually/edit/main/packages/docs/',
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
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'API', link: '/reference/api/' },
            { label: 'Benchmarks', link: '/reference/benchmarks/' },
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
