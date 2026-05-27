import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const dist = resolve(root, 'dist')

function resolveWindowsCommand(command) {
  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return command
  }

  try {
    const found = execFileSync('where.exe', [command], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)

    return found ?? command
  } catch {
    return command
  }
}

function run(command, args, options = {}) {
  const resolved = process.platform === 'win32' ? resolveWindowsCommand(command) : command
  execFileSync(resolved, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(resolved),
    ...options,
  })
}

function rustToolEnv() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    const lower = key.toLowerCase()
    if (lower.startsWith('npm_') || lower === 'init_cwd') {
      delete env[key]
    }
  }
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path')
  if (pathKey && env[pathKey]) {
    env[pathKey] = env[pathKey]
      .split(process.platform === 'win32' ? ';' : ':')
      .filter(
        (entry) =>
          !/node_modules[\\/]\.bin/i.test(entry) && !/@npmcli[\\/]run-script[\\/]lib[\\/]node-gyp-bin/i.test(entry),
      )
      .join(process.platform === 'win32' ? ';' : ':')
  }
  return env
}

rmSync(dist, { recursive: true, force: true })
run('wasm-pack', ['build', 'packages/core-wasm', '--target', 'web', '--release', '--no-opt'], {
  env: rustToolEnv(),
})
run(process.execPath, ['scripts/optimize-wasm.mjs'])
run(process.execPath, ['node_modules/tsdown/dist/run.mjs'])
run(process.execPath, ['scripts/copy-wasm.mjs'])
