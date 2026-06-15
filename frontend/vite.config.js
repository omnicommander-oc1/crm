import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  const isDev = mode === 'development'
  const config = {
    plugins: [
      vue(),
      vueJsx(),
      VitePWA({
        registerType: 'autoUpdate',
        devOptions: {
          enabled: true,
        },
        manifest: {
          display: 'standalone',
          name: 'OMNICOMMANDER CRM',
          short_name: 'OMNICOMMANDER CRM',
          start_url: '/crm',
          description:
            'OMNICOMMANDER CRM — supercharge your sales operations',
          icons: [
            {
              src: '/assets/crm/manifest/manifest-icon-192.maskable.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/assets/crm/manifest/manifest-icon-192.maskable.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: '/assets/crm/manifest/manifest-icon-512.maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/assets/crm/manifest/manifest-icon-512.maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    optimizeDeps: {
      include: [
        'feather-icons',
        'tailwind.config.js',
        'prosemirror-state',
        'prosemirror-view',
        'lowlight',
        'interactjs',
      ],
    },
    server: {
      fs: {
        allow: [path.resolve(__dirname, '..')],
      },
    },
  }

  // OCRM: opt-in remote dev proxy. Set OCRM_DEV_API to a deployed Frappe backend
  // (e.g. https://dev-ocrm.omnicommando.com) to run this Vite dev server against
  // the dev API + DB instead of a local bench. frappe-ui's built-in frappeProxy
  // only targets localhost:8000, so when OCRM_DEV_API is set we disable it and
  // wire our own HTTPS proxy. Unset => unchanged default (local bench) behavior.
  const devApi = isDev && process.env.OCRM_DEV_API

  const frappeui = await importFrappeUIPlugin(isDev, config)
  config.plugins.unshift(
    frappeui({
      frappeProxy: !devApi,
      lucideIcons: true,
      jinjaBootData: true,
      buildConfig: {
        indexHtmlPath: '../crm/www/crm.html',
        emptyOutDir: true,
        sourcemap: true,
      },
    }),
  )

  if (devApi) {
    // changeOrigin → Host becomes the backend host, so the ALB host-header rule
    // matches and the single-site frontend resolves. cookieDomainRewrite scopes
    // the session cookie to localhost. The backend site needs `ignore_csrf: 1`
    // for dev (jinjaBootData only injects the CSRF token in production builds).
    const remote = {
      target: devApi,
      changeOrigin: true,
      secure: true,
      ws: true,
      cookieDomainRewrite: '',
    }
    config.server = {
      ...config.server,
      port: 8080,
      proxy: {
        '^/(app|api|assets|files|private|method|login|desk)': remote,
        '^/socket.io': remote,
      },
    }
    console.info(`OCRM: proxying Frappe routes to ${devApi}`)

    // src/socket.js statically imports ../../../../sites/common_site_config.json
    // (a bench path). Running standalone there is no bench above us, so stub the
    // import with the socketio port. Realtime needs the websocket reachable; in
    // remote mode it falls back gracefully if not.
    config.plugins.unshift({
      name: 'ocrm-stub-common-site-config',
      enforce: 'pre',
      resolveId(id) {
        if (id.replace(/\\/g, '/').endsWith('sites/common_site_config.json')) {
          return '\0ocrm-common-site-config'
        }
      },
      load(id) {
        if (id === '\0ocrm-common-site-config') {
          return 'export const socketio_port = 9000\nexport default { socketio_port: 9000 }'
        }
      },
    })
  }

  return config
})

async function importFrappeUIPlugin(isDev, config) {
  if (isDev) {
    try {
      // Check if local frappe-ui has the vite plugin file
      const fs = await import('node:fs')
      const localVitePluginPath = path.resolve(__dirname, '../frappe-ui/vite')

      if (fs.existsSync(localVitePluginPath)) {
        const module = await import('../frappe-ui/vite')
        console.info('Local frappe-ui vite plugin found, using local plugin')
        config.resolve.alias = getAliases(config)
        return module.default
      } else {
        console.warn('Local frappe-ui vite plugin not found, using npm package')
      }
    } catch (error) {
      console.warn(
        'Local frappe-ui not found, falling back to npm package:',
        error.message,
      )
    }
  }
  // Fall back to npm package if local import fails
  const module = await import('frappe-ui/vite')
  return module.default
}

function getAliases(config) {
  return {
    ...config.resolve.alias,
    'frappe-ui/tailwind': path.resolve(
      __dirname,
      '../frappe-ui/tailwind/preset.js',
    ),
    'frappe-ui/style.css': path.resolve(
      __dirname,
      '../frappe-ui/src/style.css',
    ),
    'frappe-ui/frappe': path.resolve(__dirname, '../frappe-ui/frappe/index.js'),
    'frappe-ui': path.resolve(__dirname, '../frappe-ui/src/index.ts'),
  }
}
