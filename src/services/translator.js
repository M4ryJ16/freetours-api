import translate from 'translate'
import { config } from '#config/env.js'
import { SOURCE_LANG, TICKET_STRINGS_ES } from './ticketStrings.js'

export const DEFAULT_LANG = SOURCE_LANG

// The "translate" package takes its engine/key as global settings (they
// can't be passed per call).
translate.engine = config.translateEngine
if (config.translateKey) translate.key = config.translateKey

// Per-language, per-string cache of successful translations. Booking
// tickets reuse the same static text for every customer, so after the
// first ticket in a given language no further translation requests are
// made. Failed strings are NOT cached, so they get retried next time.
const cache = new Map() // lang -> Map(key -> translated string)
// Dedupes simultaneous first requests for the same language.
const inflight = new Map() // lang -> Promise

const CONCURRENCY = 4

// 'pt-BR' / 'en_US' / 'ES' -> 'pt' / 'en' / 'es'. Anything unusable falls
// back to the default language.
export function normalizeLang(lang) {
  const base = String(lang ?? '').trim().toLowerCase().split(/[-_]/)[0]
  return /^[a-z]{2,3}$/.test(base) ? base : DEFAULT_LANG
}

async function translateMissing(to, langCache, log) {
  const pending = Object.entries(TICKET_STRINGS_ES).filter(([key]) => !langCache.has(key))
  let failures = 0

  async function worker() {
    while (pending.length) {
      const [key, text] = pending.shift()
      try {
        const translated = await translate(text, { from: SOURCE_LANG, to })
        if (translated && String(translated).trim()) langCache.set(key, String(translated))
        else failures++
      } catch (err) {
        failures++
        log?.warn({ err, key, to }, 'Ticket string translation failed — using Spanish for this string')
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  if (failures) log?.warn({ to, failures }, 'Some ticket strings could not be translated')
}

/**
 * Returns the ticket string catalog in the requested language. Never
 * throws: any string that can't be translated falls back to the Spanish
 * original, so a translation outage never blocks a ticket email.
 */
export async function getTicketStrings(lang, log) {
  const to = normalizeLang(lang)
  if (to === SOURCE_LANG) return TICKET_STRINGS_ES

  let langCache = cache.get(to)
  if (!langCache) {
    langCache = new Map()
    cache.set(to, langCache)
  }

  if (langCache.size < Object.keys(TICKET_STRINGS_ES).length) {
    let job = inflight.get(to)
    if (!job) {
      job = translateMissing(to, langCache, log).finally(() => inflight.delete(to))
      inflight.set(to, job)
    }
    await job
  }

  return Object.fromEntries(
    Object.entries(TICKET_STRINGS_ES).map(([key, original]) => [key, langCache.get(key) ?? original])
  )
}
