import { describe, expect, it } from 'vitest'
import { safeReturn } from './returnPath'

describe('where to go after signing in', () => {
  it('allows a path on this site', () => {
    expect(safeReturn('/folio')).toBe('/folio')
    expect(safeReturn('/')).toBe('/')
  })

  it('sends a missing or empty value home', () => {
    expect(safeReturn(undefined)).toBe('/')
    expect(safeReturn(null)).toBe('/')
    expect(safeReturn('')).toBe('/')
  })

  it('refuses to forward anyone off this site', () => {
    expect(safeReturn('https://evil.example/sign-in')).toBe('/')
    expect(safeReturn('//evil.example/sign-in')).toBe('/')
    expect(safeReturn('/\\evil.example')).toBe('/')
    expect(safeReturn('javascript:alert(1)')).toBe('/')
  })

  it('reads only a string, whatever vue-router puts in the query', () => {
    expect(safeReturn(['/folio'])).toBe('/')
    expect(safeReturn({ path: '/folio' })).toBe('/')
  })
})
