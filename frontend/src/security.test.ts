import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('static secret boundary', () => {
  it('does not add browser persistence or console logging to application source', () => {
    const root = resolve(import.meta.dirname)
    const source = ['App.tsx', 'lib/seed.ts', 'lib/providers.ts', 'lib/migration.ts'].map((path) => readFileSync(resolve(root, path), 'utf8')).join('\n')
    expect(source).not.toMatch(/localStorage|sessionStorage|console\.(log|debug|info)/)
  })

  it('ships a restrictive inline CSP with discovery providers and exact BRC-100 loopback bridges', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../index.html'), 'utf8')
    expect(html).toContain("default-src 'self'")
    expect(html).toContain("object-src 'none'")
    expect(html).toContain('https://api.whatsonchain.com https://api.bitails.io')
    expect(html).toContain('http://localhost:3301 http://localhost:3321 https://localhost:2121')
    expect(html).not.toContain('http://localhost:*')
    expect(html).not.toContain('http://127.0.0.1:*')
  })

  it('refuses to expose recovery controls inside an embedding frame', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'main.tsx'), 'utf8')
    expect(source).toContain('window.top !== window.self')
  })
})
