import { getTicketStrings, normalizeLang, DEFAULT_LANG } from '#services/translator.js'

// Exposes the ticket text catalog in a given language so other clients —
// notably the frontend's PDF ticket generator — reuse the exact same
// strings (and the same translation cache) as the ticket emails, instead
// of translating on their own.
export default async function i18nRoutes(fastify) {
  fastify.get('/i18n/ticket-strings', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          lang: { type: 'string', pattern: '^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$', default: DEFAULT_LANG }
        },
        additionalProperties: false
      }
    }
  }, async (request) => {
    const { lang = DEFAULT_LANG } = request.query
    return { lang: normalizeLang(lang), strings: await getTicketStrings(lang, request.log) }
  })
}
