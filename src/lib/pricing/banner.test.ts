import { describe, it, expect } from 'vitest'
import { parseBannerSize, quoteBanner, bannerPriceFact } from './banner'

describe('parseBannerSize', () => {
  it('reads the shapes customers actually type', () => {
    expect(parseBannerSize('banner 24x36')).toEqual({ width: 24, height: 36, unit: 'in' })
    expect(parseBannerSize('un banner 24 x 36"')).toEqual({ width: 24, height: 36, unit: 'in' })
    expect(parseBannerSize('48x72 pulgadas')).toEqual({ width: 48, height: 72, unit: 'in' })
    expect(parseBannerSize('a 4ft x 8ft vinyl banner')).toEqual({ width: 4, height: 8, unit: 'ft' })
    expect(parseBannerSize('de 5 por 7 pies')).toEqual({ width: 5, height: 7, unit: 'ft' })
    expect(parseBannerSize('3 pies x 6 pies')).toEqual({ width: 3, height: 6, unit: 'ft' })
    expect(parseBannerSize('60" x 120"')).toEqual({ width: 60, height: 120, unit: 'in' })
  })

  // Nobody orders a 24-foot-wide banner over WhatsApp without saying so,
  // so a number over 12 means inches.
  it('infers inches when a number is too big to be feet', () => {
    expect(parseBannerSize('24x36')?.unit).toBe('in')
    expect(parseBannerSize('banner 48x96')?.unit).toBe('in')
  })

  // 4x8 feet is $256.00; 4x8 inches does not reach the minimum. There is
  // no safe default between those, so it goes to a human.
  it('refuses a small pair with no unit — it is genuinely ambiguous', () => {
    expect(parseBannerSize('4x8')).toBeNull()
    expect(parseBannerSize('10x12')).toBeNull()
    // But it is fine as soon as the customer says which.
    expect(parseBannerSize('4x8 ft')).toEqual({ width: 4, height: 8, unit: 'ft' })
  })

  it('returns null when there is no size', () => {
    expect(parseBannerSize('cuanto cuesta un banner?')).toBeNull()
    expect(parseBannerSize('quiero 3 banners')).toBeNull()
    expect(parseBannerSize('')).toBeNull()
  })

  // Two sizes in one message is a conversation for a human, not
  // something to quote blind on whichever one matched first.
  it('returns null when the message holds more than one size', () => {
    expect(parseBannerSize('quiero uno de 24x36 y otro de 48x72')).toBeNull()
  })

  // The pattern matches these perfectly; only the physical bounds save us.
  it('ignores number pairs that are not measurements', () => {
    expect(parseBannerSize('llamame al 347 por 5 minutos')).toBeNull()
    expect(parseBannerSize('mi local mide 100 x 200 pies')).toBeNull()
    expect(parseBannerSize('un banner de 2 x 3 pulgadas')).toBeNull()
  })
})

describe('quoteBanner', () => {
  it('prices the sizes that were quoted wrong in production', () => {
    // The bug that started this: the model said $256.00.
    expect(quoteBanner({ width: 48, height: 72, unit: 'in' })).toEqual({
      size: { width: 48, height: 72, unit: 'in' },
      sqft: 24,
      price: 192,
    })
    // Another run said $640.00.
    expect(quoteBanner({ width: 60, height: 120, unit: 'in' })?.price).toBe(400)
    // And another said $88.00 for this one (it is below the minimum).
    expect(quoteBanner({ width: 20, height: 30, unit: 'in' })).toBeNull()
  })

  it('rounds part square feet up, never down', () => {
    // 30x40" is 8.33 sq ft → 9.
    expect(quoteBanner({ width: 30, height: 40, unit: 'in' })).toMatchObject({
      sqft: 9,
      price: 72,
    })
  })

  it('handles feet without converting anything', () => {
    expect(quoteBanner({ width: 4, height: 8, unit: 'ft' })?.price).toBe(256)
    expect(quoteBanner({ width: 3, height: 6, unit: 'ft' })?.price).toBe(144)
  })

  it('refuses anything under the minimum', () => {
    expect(quoteBanner({ width: 10, height: 12, unit: 'in' })).toBeNull()
    expect(quoteBanner({ width: 24, height: 24, unit: 'in' })).toBeNull() // 4 sq ft
  })

  it('is symmetric — the order of the sides cannot change the price', () => {
    const a = quoteBanner({ width: 48, height: 72, unit: 'in' })!
    const b = quoteBanner({ width: 72, height: 48, unit: 'in' })!
    expect(a.price).toBe(b.price)
  })
})

describe('bannerPriceFact', () => {
  it('states the price so plainly there is nothing left to work out', () => {
    const fact = bannerPriceFact('que me cuesta un banner 48x72?')!
    expect(fact).toContain('$192.00')
    expect(fact).toContain('24 square feet')
    expect(fact).toContain('do not recompute')
  })

  it('says nothing when there is no size or it is too small', () => {
    expect(bannerPriceFact('cuanto cuesta un banner?')).toBeNull()
    expect(bannerPriceFact('un banner de 10x12 pulgadas')).toBeNull()
  })
})
