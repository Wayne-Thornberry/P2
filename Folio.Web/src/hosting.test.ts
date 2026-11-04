import { describe, expect, it } from 'vitest'
import config from '../web.config?raw'

/**
 * What IIS is told to do with the site's files, read from the file that ships with them.
 *
 * The deploy proves the headers on the box, which is the real answer; this is the same
 * claim earlier, where it costs a second and names the file, so a change that quietly
 * turns caching back on fails before it is deployed rather than after a stale page.
 */
const withoutComments = config.replace(/<!--[\s\S]*?-->/g, '')

function header(name: string): string | undefined {
  const match = withoutComments.match(new RegExp(`<add name="${name}" value="([^"]*)"`, 'i'))

  return match?.[1]
}

describe('the site IIS serves', () => {
  it('keeps nothing, which is the whole of index.html being what names the bundles', () => {
    expect(header('Cache-Control')).toMatch(/no-store/)
    expect(header('Cache-Control')).toMatch(/no-cache/)
  })

  it('says the same thing for whatever only reads HTTP/1.0', () => {
    expect(header('Pragma')).toBe('no-cache')
    expect(header('Expires')).toBe('0')
  })

  it('does not leave clientCache on beside those headers, which would duplicate Cache-Control', () => {
    expect(withoutComments).not.toMatch(/<clientCache/i)
  })

  it('turns IIS output caching off, which no header can argue with', () => {
    expect(withoutComments).toMatch(/<caching enabled="false"[^>]*enableKernelCache="false"/)
  })

  it('still serves the pdf.js worker as a module, which is how a statement is read', () => {
    expect(config).toMatch(/<mimeMap fileExtension="\.mjs" mimeType="text\/javascript"\s*\/>/)
  })
})
