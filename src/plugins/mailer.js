import fp from 'fastify-plugin'
import nodemailer from 'nodemailer'
import QRCode from 'qrcode'
import StaticMaps from 'staticmaps'
import { config } from '#config/env.js'
import { escape } from 'html-escaper'

// Brand logo (the "M" horse-head mark), sent as a cid attachment — same
// approach as the meeting-point map and the QR code below. Gmail (and
// several other clients) frequently fails to render base64 data-URI
// images inline, especially on messages that land in spam, so cid
// attachments are the more reliable way to embed a fixed image too.
const LOGO_BASE64 = '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'
const LOGO_BUFFER = Buffer.from(LOGO_BASE64, 'base64')

// Palette matched to the PDF ticket's COLOR object (mi-reserva/[id].pdf.ts)
// so the email and PDF tickets read as the same document. Only the
// dark-green header/footer bands and the light parchment/cream body
// carry over — the map and manage-booking QR code stay email-only, since
// the PDF already offers a "ver ubicación" link/button instead.
const COLORS = {
  forestDeep: '#1b2921',   // header/footer band, matches PDF forestDeep
  parchment: '#f8f3e5',    // page background, matches PDF parchment
  cream: '#fff7ec',        // card background, matches PDF cream
  parchmentAlt: '#f2e9d7', // warning box background, matches PDF parchmentAlt
  gold: '#d99b32',         // eyebrow / accent text, matches PDF gold
  goldSoft: '#e8b969',     // muted header subtext, matches PDF goldSoft
  ink: '#182219',          // body text, matches PDF ink
  russet: '#9d2e21',       // secondary button, matches PDF russet
  orange: '#e7791a',       // "RUTA" band + primary button, matches PDF orange
  line: '#c9bda3'          // borders / dividers, matches PDF line
}

/**
 * Decorates the Fastify instance with `fastify.sendBookingTicket(email, ticket)`.
 *
 * If SMTP_HOST is configured, sends a real email via nodemailer with the
 * customer's tour-registration ticket. If it's not configured (e.g. local
 * development without SMTP credentials), the ticket is logged instead of
 * sent, so booking still works end to end without a mail provider.
 *
 * The meeting point is intentionally NOT written out as an address in the
 * email — it's shown as an embedded static map image rendered server-side
 * from OpenStreetMap tiles (no API key, no billing), built from
 * ticket.meetingPointLat/meetingPointLng and attached as a cid image. The
 * email also embeds a QR code, generated from
 * `${MANAGE_BOOKING_URL}/${bookingId}`, linking to the page where the
 * customer can edit or cancel their booking, a big "Ver mi reserva" button
 * pointing to the same URL, plus a plain link to view the meeting point on
 * openstreetmap.org (with the attribution OSM requires).
 *
 * The overall look (parchment page, dark-green header/footer bands, the
 * cream details card with an orange "RUTA" header row) is designed to
 * match the PDF ticket generated by mi-reserva/[id].pdf.ts, so a customer
 * recognizes the same ticket whether they're looking at the email or the
 * downloaded PDF. The map image and manage/cancel QR code are kept
 * email-only, since they're only meaningful in an inbox context.
 *
 * `ticket` shape:
 * {
 *   bookingId, status, customerName, tourName, tourDate, departureTime,
 *   quantity, numberOfChildren, numberOfBabies, numberOfPets,
 *   meetingPointLat, meetingPointLng
 * }
 */
export default fp(async function mailerPlugin(fastify) {
  const transport = config.smtpHost
    ? nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure,
        auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined
      })
    : null

  if (!transport) {
    fastify.log.warn(
      'SMTP_HOST is not configured — booking tickets will be logged instead of emailed. ' +
      'Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM to send real emails.'
    )
  }
  if (config.osmTileUrl.includes('tile.openstreetmap.org')) {
    fastify.log.warn(
      'Using the public tile.openstreetmap.org tile server for meeting-point map images. ' +
      'Its usage policy (https://operations.osmfoundation.org/policies/tiles/) asks that this ' +
      'not be used for heavy automated/production traffic — for anything beyond light volume, ' +
      'set OSM_TILE_URL to a self-hosted or commercial OSM-tile provider.'
    )
  }
  if (!config.manageBookingUrl) {
    fastify.log.warn(
      'MANAGE_BOOKING_URL is not configured — booking ticket emails will skip the "Ver mi reserva" ' +
      'button and the manage/cancel QR code.'
    )
  }

  if (!config.reticketsEmail) {
    fastify.log.warn(
      'RETICKETS_EMAIL is not configured — booking tickets will not be copied to a secondary inbox.'
    )
  }

  // Renders a static map image (as PNG bytes) centered on the meeting
  // point using OpenStreetMap tiles — no API key or billing required.
  // Returns null if coordinates are missing or rendering fails; callers
  // fall back to a text/link notice in that case.
  async function fetchMeetingPointMap(lat, lng) {
    if (lat == null || lng == null) return null
    try {
      const map = new StaticMaps({
        width: 600,
        height: 300,
        tileUrl: config.osmTileUrl,
        tileRequestHeaders: { 'User-Agent': config.osmTileUserAgent },
        tileSize: 256
      })
      // A plain circle marker — avoids needing an external marker icon
      // asset on disk (which addMarker() would require).
      map.addCircle({
        coord: [lng, lat],
        radius: 10,
        fill: '#e63946',
        color: '#ffffff',
        width: 3
      })
      await map.render([lng, lat], 16)
      return await map.image.buffer('image/png')
    } catch (err) {
      fastify.log.error({ err }, 'Failed to render meeting-point map image')
      return null
    }
  }

  // Builds the manage-booking URL (MANAGE_BOOKING_URL + '/' + bookingId).
  // Returns null if MANAGE_BOOKING_URL isn't configured.
  function buildManageUrl(bookingId) {
    if (!config.manageBookingUrl) return null
    return `${config.manageBookingUrl.replace(/\/+$/, '')}/${bookingId}`
  }

  // Renders the manage-booking URL as a QR code PNG. Returns null if
  // generation fails.
  async function buildManageQrCode(manageUrl) {
    if (!manageUrl) return null
    try {
      return await QRCode.toBuffer(manageUrl, { type: 'png', width: 260, margin: 1 })
    } catch (err) {
      fastify.log.error({ err, manageUrl }, 'Failed to generate manage-booking QR code')
      return null
    }
  }

  // Daily operational summary — how many reservations, and their party
  // composition, are on the books for each upcoming (tour, date, time)
  // slot. Distinct from sendBookingTicket: this isn't a customer-facing
  // ticket, just a plain internal digest sent to SUMMARY_EMAIL. Reuses
  // the same brand colors so it's visually recognizable as one of ours,
  // but with none of the customer-ticket furniture (map, QR, notices).
  fastify.decorate('sendReservationsSummaryEmail', async function sendReservationsSummaryEmail(email, { dateFrom, dateTo, rows }) {
    const brandName = 'Meriyo Tours Dublín'
    const subject = rows.length
      ? `Resumen de reservas: ${dateFrom} a ${dateTo} (${rows.length} salida${rows.length === 1 ? '' : 's'})`
      : `Resumen de reservas: ${dateFrom} a ${dateTo} (sin reservas)`

    const totals = rows.reduce((acc, r) => {
      acc.bookings += r.booking_count
      acc.adults += r.adults
      acc.children += r.children
      acc.babies += r.babies
      acc.pets += r.pets
      return acc
    }, { bookings: 0, adults: 0, children: 0, babies: 0, pets: 0 })

    const formatDate = (value) => {
      let datePart
      if (value instanceof Date) {
        // pg returns DATE columns as JS Date objects (in local/UTC midnight) —
        // use the UTC getters to avoid a timezone shift landing on the wrong day.
        const y = value.getUTCFullYear()
        const m = String(value.getUTCMonth() + 1).padStart(2, '0')
        const d = String(value.getUTCDate()).padStart(2, '0')
        datePart = `${y}-${m}-${d}`
      } else {
        datePart = String(value).includes('T') ? String(value).split('T')[0] : String(value)
      }
      return new Date(`${datePart}T00:00:00`).toLocaleDateString('es-ES', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
      })
    }
    const formatTime = (value) => String(value).slice(0, 5)

    const textRows = rows.map((r) =>
      `${formatDate(r.date)} ${formatTime(r.time)} — ${r.tour_name} — ${r.customer_names}: ${r.booking_count} reserva(s) — ` +
      `${r.adults} adultos, ${r.children} niños, ${r.babies} bebés, ${r.pets} mascotas ` +
      `(total: ${r.adults + r.children + r.babies + r.pets})`
    )

    const text = [
      brandName,
      '----------------------------------------',
      `Resumen de reservas: ${dateFrom} a ${dateTo}`,
      '',
      ...(textRows.length ? textRows : ['No hay reservas en este periodo.']),
      '',
      `Totales — reservas: ${totals.bookings}, adultos: ${totals.adults}, niños: ${totals.children}, bebés: ${totals.babies}, mascotas: ${totals.pets}`,
      '----------------------------------------',
      `© ${new Date().getFullYear()} ${brandName}`
    ].join('\n')

    const th = (label, align = 'left') => `
      <th style="padding:10px 12px; text-align:${align}; font-size:11px; text-transform:uppercase; letter-spacing:0.4px; color:${COLORS.ink}; opacity:0.7; border-bottom:2px solid ${COLORS.line};">${label}</th>
    `
    const td = (value, align = 'left', strong = false) => `
      <td style="padding:10px 12px; text-align:${align}; font-size:13px; ${strong ? 'font-weight:700;' : ''} color:${COLORS.ink}; border-bottom:1px solid ${COLORS.line};">${value}</td>
    `

    const rowHtml = (r) => `
      <tr>
        ${td(escape(formatDate(r.date)))}
        ${td(escape(formatTime(r.time)))}
        ${td(escape(r.tour_name))}
        ${td(escape(r.customer_names || ''))}
        ${td(r.booking_count, 'right')}
        ${td(r.adults, 'right')}
        ${td(r.children, 'right')}
        ${td(r.babies, 'right')}
        ${td(r.pets, 'right')}
        ${td(r.adults + r.children + r.babies + r.pets, 'right', true)}
      </tr>
    `

    const tableHtml = rows.length
      ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.cream}; border:1px solid ${COLORS.line}; border-collapse:collapse;">
          <thead>
            <tr>
              ${th('Fecha')}${th('Hora')}${th('Ruta')}${th('Nombre')}${th('Reservas', 'right')}${th('Adultos', 'right')}${th('Niños', 'right')}${th('Bebés', 'right')}${th('Mascotas', 'right')}${th('Total', 'right')}
            </tr>
          </thead>
          <tbody>${rows.map(rowHtml).join('')}</tbody>
          <tfoot>
            <tr style="background-color:${COLORS.parchmentAlt};">
              <td colspan="4" style="padding:10px 12px; font-size:13px; font-weight:700; color:${COLORS.ink};">Totales</td>
              <td style="padding:10px 12px; font-size:13px; font-weight:700; color:${COLORS.ink}; text-align:right;">${totals.bookings}</td>
              <td style="padding:10px 12px; font-size:13px; font-weight:700; color:${COLORS.ink}; text-align:right;">${totals.adults}</td>
              <td style="padding:10px 12px; font-size:13px; font-weight:700; color:${COLORS.ink}; text-align:right;">${totals.children}</td>
              <td style="padding:10px 12px; font-size:13px; font-weight:700; color:${COLORS.ink}; text-align:right;">${totals.babies}</td>
              <td style="padding:10px 12px; font-size:13px; font-weight:700; color:${COLORS.ink}; text-align:right;">${totals.pets}</td>
              <td style="padding:10px 12px; font-size:13px; font-weight:700; color:${COLORS.ink}; text-align:right;">${totals.adults + totals.children + totals.babies + totals.pets}</td>
            </tr>
          </tfoot>
        </table>
      `
      : `<p style="margin:0; font-size:13px; color:${COLORS.ink};">No hay reservas en este periodo.</p>`

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
      </head>
      <body style="margin:0; padding:0; background-color:${COLORS.parchment}; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:720px; margin:0 auto; background-color:${COLORS.parchment};">
          <tr>
            <td style="background-color:${COLORS.forestDeep}; padding:24px 24px 20px 24px;">
              <p style="margin:0; font-size:11px; font-weight:700; letter-spacing:0.8px; color:${COLORS.gold}; text-transform:uppercase;">Meriyo Tours Dublín</p>
              <h1 style="margin:6px 0 0 0; font-size:20px; font-style:italic; font-weight:700; color:${COLORS.cream};">Resumen de reservas</h1>
              <p style="margin:6px 0 0 0; font-size:12px; color:${COLORS.goldSoft};">${escape(dateFrom)} a ${escape(dateTo)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 24px; color:${COLORS.ink};">
              ${tableHtml}
            </td>
          </tr>
          <tr>
            <td style="background-color:${COLORS.forestDeep}; padding:16px 24px;">
              <p style="margin:0; font-size:10px; color:${COLORS.goldSoft};">© ${new Date().getFullYear()} ${brandName}. Envío automático diario.</p>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `

    if (!transport) {
      fastify.log.warn(
        { email, dateFrom, dateTo, rowCount: rows.length },
        'DEV MODE: reservations summary (not emailed, SMTP not configured)'
      )
      return { delivered: false }
    }

    try {
      await transport.sendMail({ from: config.smtpFrom, to: email, subject, text, html })
      return { delivered: true }
    } catch (err) {
      fastify.log.error({ err, email }, 'Failed to send reservations summary email')
      return { delivered: false, error: err.message }
    }
  })

  fastify.decorate('sendBookingTicket', async function sendBookingTicket(email, ticket) {
    const brandName = 'Meriyo Tours Dublín'
    const {
      bookingId, status, customerName, tourName,
      tourDate, departureTime, quantity, numberOfChildren, numberOfBabies, numberOfPets,
      meetingPointLat, meetingPointLng
    } = ticket

    const partyLines = [
      `${quantity} adult${quantity === 1 ? '' : 's'}`,
      numberOfChildren ? `${numberOfChildren} child${numberOfChildren === 1 ? '' : 'ren'}` : null,
      numberOfBabies ? `${numberOfBabies} bab${numberOfBabies === 1 ? 'y' : 'ies'}` : null,
      numberOfPets ? `${numberOfPets} pet${numberOfPets === 1 ? '' : 's'}` : null
    ].filter(Boolean).join(', ')

    const subject = `Your free tour ticket: ${tourName}`

    const osmLink = (meetingPointLat != null && meetingPointLng != null)
      ? `https://www.openstreetmap.org/?mlat=${meetingPointLat}&mlon=${meetingPointLng}#map=17/${meetingPointLat}/${meetingPointLng}`
      : null

    const manageUrl = buildManageUrl(bookingId)

    const [mapBuffer, qrBuffer] = await Promise.all([
      fetchMeetingPointMap(meetingPointLat, meetingPointLng),
      buildManageQrCode(manageUrl)
    ])

    // Quiet footnote on what a free tour actually is and how a tip can be
    // given, if the customer wants to leave one. Deliberately understated
    // in both the plain-text and HTML versions below — no heading, no
    // exclamation marks, no styling that calls attention to it. It's meant
    // to be found by whoever reads the ticket closely, not skimmed past.
    const freeTourNote = 'Un free tour es una visita guiada sin precio fijo: al finalizar, cada persona aporta la propina que considere justa según lo que le haya aportado la experiencia. Si quieres dejar propina, puedes hacerlo en efectivo o mediante tarjeta, Revolut o Bizum.'

    const text = [
      `${brandName}`,
      '----------------------------------------',
      `Hi ${customerName},`,
      '',
      `Your spot on "${tourName}".`,
      '',
      `Date: ${tourDate}`,
      `Departure time: ${departureTime}`,
      `Party: ${partyLines}`,
      `Booking reference: ${bookingId}`,
      '',
      'The meeting point is shown on the map in this email.',
      osmLink ? `View it on OpenStreetMap: ${osmLink}` : null,
      manageUrl ? `To view, edit or cancel your booking, visit: ${manageUrl}` : 'Contact us if you need to edit or cancel your booking.',
      '',
      freeTourNote,
      '----------------------------------------',
      'Privacy policy: https://www.meriyotoursdublin.com/politicas-privacidad',
      `© ${new Date().getFullYear()} ${brandName}`
    ].filter(Boolean).join('\n')

    const safe = {
      customerName: escape(String(customerName)),
      tourName: escape(String(tourName)),
      tourDate: escape(String(tourDate)),
      departureTime: escape(String(departureTime)),
      partyLines: escape(partyLines),
      status: escape(String(status)),
      bookingId: escape(String(bookingId))
    }

    // Header title mirrors the PDF's "Reserva confirmada" heading, with a
    // cancelled variant to match the cancel/cancelled button state below.
    const headerTitle = status === 'cancelled' ? 'Reserva cancelada' : 'Reserva confirmada'

    // Map and QR are attached as cid images, same as the logo above —
    // cid attachments are the broadly compatible way for mail clients to
    // render embedded, offline-safe images. Styling matches the PDF's
    // "PUNTO DE ENCUENTRO" section, but keeps the actual map image and
    // OSM attribution, which the PDF doesn't have room for.
    const mapHtml = mapBuffer
      ? `
        <img src="cid:meetingpointmap" alt="Punto de encuentro" width="600" height="300" style="display:block; width:100%; max-width:600px; height:auto; border-radius:8px; border:1px solid ${COLORS.line};" />
        <p style="margin: 8px 0 0 0; font-size: 11px; color: ${COLORS.ink}; opacity: 0.65;">
          Datos del mapa &copy; <a href="https://www.openstreetmap.org/copyright" style="color: ${COLORS.ink};">OpenStreetMap</a> contributors
          ${osmLink ? ` &mdash; <a href="${osmLink}" style="color: ${COLORS.russet};">abrir en OpenStreetMap</a>` : ''}
        </p>
      `
      : `<p style="margin: 0; font-size: 13px; color: ${COLORS.ink};">El mapa del punto de encuentro no está disponible.${osmLink ? ` <a href="${osmLink}" style="color:${COLORS.russet};">Ver en OpenStreetMap</a>.` : ' Por favor contáctanos para indicaciones.'}</p>`

    const buttonHtml = manageUrl
      ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0 12px 0;">
          <tr>
            <td align="center">
              <a href="${manageUrl}" style="display:inline-block; background-color:${COLORS.orange}; color:${COLORS.cream}; font-size:14px; font-weight:700; text-decoration:none; padding:14px 36px; letter-spacing:0.3px;">
                Ver mi reserva
              </a>
            </td>
          </tr>
        </table>
      `
      : ''

    const cancelButtonHtml = manageUrl
      ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 20px 0;">
          <tr>
            <td align="center">
              <a href="${manageUrl}?cancel=true" style="display:inline-block; background-color:${COLORS.forestDeep}; color:${COLORS.cream}; font-size:13px; font-weight:700; text-decoration:none; padding:13px 36px; letter-spacing:0.3px;">
                Cancelar reserva
              </a>
            </td>
          </tr>
        </table>
      `
      : ''

    const canceledButtonHtml = manageUrl
      ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 20px 0;">
          <tr>
            <td align="center">
              <a href="${manageUrl}" style="display:inline-block; background-color:transparent; color:${COLORS.russet}; font-size:13px; font-weight:700; text-decoration:none; padding:12px 34px; border:1.5px solid ${COLORS.russet}; letter-spacing:0.3px;">
                Reserva cancelada
              </a>
            </td>
          </tr>
        </table>
      `
      : ''

    const qrHtml = qrBuffer
      ? `
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 4px;">
          <tr>
            <td align="center">
              <img src="cid:manageqrcode" alt="Código QR para gestionar tu reserva" width="120" height="120" style="background:#ffffff; padding:8px; border:1px solid ${COLORS.line};" />
              <p style="margin: 10px 0 0 0; font-size: 12px; color: ${COLORS.ink}; opacity: 0.65;">
                Escanea para gestionar o cancelar tu reserva
              </p>
            </td>
          </tr>
        </table>
      `
      : ''

    // Notice box: cream background, dark-green border, gold warning
    // triangle — matches the "Esta reserva está condicionada..." box
    // style. Reused for all three end-of-ticket notices below.
    const warningBox = (message) => `
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.parchment}; border: 2px solid ${COLORS.forestDeep}; border-radius: 6px; margin: 14px 0;">
        <tr>
          <td style="padding: 14px 6px 14px 16px; width: 30px; vertical-align: top;">
            <span style="font-size: 18px; line-height: 1; color: ${COLORS.gold};">&#9888;&#65039;</span>
          </td>
          <td style="padding: 14px 16px 14px 4px; font-size: 12.5px; line-height: 1.5; color: ${COLORS.ink};">
            ${message}
          </td>
        </tr>
      </table>
    `

    const conditionalBookingNoticeHtml = warningBox(
      'Esta reserva está condicionada y puede sufrir variaciones o cancelaciones si no se cumple el mínimo de 4 personas. Te lo notificaremos por WhatsApp o email. Gracias por tu comprensión. El guía se reserva el derecho de admisión.'
    )

    const healthInsuranceNoticeHtml = warningBox(
      'El seguro del tour solo cubre incidentes ocurridos directamente durante el trayecto. No cubre malestares gástricos por alimentos/bebidas (ya que no los proporcionamos) ni incidentes por descuido personal. Las mascotas son bienvenidas reservando su lugar, pero no tienen cobertura de seguro y cualquier gasto o imprevisto corre totalmente por cuenta de sus dueños.'
    )

    const arriveEarlyNoticeHtml = warningBox(
      'Llega al punto de encuentro con 15 minutos de antelación. La salida es puntual y no podremos esperar a quien llegue tarde.'
    )

    const bringItemsNoticeHtml = warningBox(
      'No olvides traer contigo lo necesario para la ruta (calzado cómodo, agua y ropa adecuada para la meteorología prevista).'
    )

    const legalNoticeHtml = warningBox(
      'Seguridad y responsabilidad en el tour: Guío los paseos con total tranquilidad porque cuento con un seguro de responsabilidad civil profesional. No obstante, ten en cuenta que cada participante se une a la caminata bajo su propia responsabilidad en lo referente a su estado físico, salud y pertenencias personales. Te recomiendo venir con calzado cómodo apto para los adoquines de Dublín y avisarme si tienes alguna molestia antes de empezar. El seguro cubre la actividad profesional del guía, pero no lesiones previas, dolencias de casa ni despistes con tus objetos personales. ¡Prevenir es curar!'
    )

    // Quiet footnote, HTML version: no box, no border, no accent color —
    // small italic text at low opacity so it sits into the parchment
    // background rather than calling attention to itself. Placed right
    // before the footer band, after everything else has already been read.
    const freeTourNoteHtml = `
      <p style="margin: 22px 0 0 0; font-size: 10.5px; font-style: italic; line-height: 1.5; color: ${COLORS.ink}; opacity: 0.55;">
        ${escape(freeTourNote)}
      </p>
    `

    // Row layout mirrors the PDF's details card: label left, bold value
    // right, thin divider between rows.
    const detailRow = (label, value, isLast) => `
      <tr>
        <td style="padding: 12px 0; border-bottom: ${isLast ? 'none' : `1px solid ${COLORS.line}`}; font-size: 12px; color: ${COLORS.ink}; opacity: 0.75; vertical-align: top; white-space: nowrap;">
          ${label}
        </td>
        <td style="padding: 12px 0; border-bottom: ${isLast ? 'none' : `1px solid ${COLORS.line}`}; font-size: 14px; font-weight: 700; color: ${COLORS.ink}; text-align: right;">
          ${value}
        </td>
      </tr>
    `

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: ${COLORS.parchment}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; margin: 0 auto; background-color: ${COLORS.parchment};">
          <!-- Header band, matches the PDF's dark-green header -->
          <tr>
            <td style="background-color: ${COLORS.forestDeep}; padding: 26px 24px 22px 24px; text-align: left;">
              <img src="cid:brandlogo" width="40" height="40" alt="${brandName}" style="display:block; margin-bottom: 14px;" />
              <p style="margin: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.8px; color: ${COLORS.gold}; text-transform: uppercase;">
                Meriyo Tours Dublín
              </p>
              <p style="margin: 3px 0 10px 0; font-size: 9px; letter-spacing: 0.6px; color: ${COLORS.goldSoft}; text-transform: uppercase;">
                Excursión gratuita
              </p>
              <h1 style="margin: 0; font-size: 22px; font-style: italic; font-weight: 700; color: ${COLORS.cream};">
                ${headerTitle}
              </h1>
            </td>
          </tr>
          <!-- Content, light parchment body like the PDF page -->
          <tr>
            <td style="padding: 26px 24px; color: ${COLORS.ink};">
              <p style="margin: 0 0 20px 0; font-size: 13px; color: ${COLORS.ink}; opacity: 0.8;">
                Hola ${safe.customerName}, esta es tu plaza en <strong>${safe.tourName}</strong>.
              </p>

              <!-- Details card, cream bg with orange "RUTA" header, mirrors the PDF card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${COLORS.cream}; border: 1px solid ${COLORS.line};">
                <tr>
                  <td style="background-color: ${COLORS.orange}; padding: 12px 16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: ${COLORS.cream};">RUTA</td>
                        <td style="font-size: 13px; font-weight: 700; color: ${COLORS.cream}; text-align: right;">${safe.tourName}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 4px 16px 6px 16px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      ${detailRow('Fecha', safe.tourDate)}
                      ${detailRow('Hora', safe.departureTime)}
                      ${detailRow('Personas', safe.partyLines)}
                      ${detailRow('Referencia', safe.bookingId)}
                      ${detailRow('Precio final', '0.00€', true)}
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin: 24px 0 10px 0; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; color: ${COLORS.gold}; text-transform: uppercase;">Punto de encuentro</p>
              ${mapHtml}

              <p style="margin: 20px 0 0 0; font-size: 11px; color: ${COLORS.ink}; opacity: 0.65; text-align:center;">
                Esta excursión es gratuita — no se necesita pago ni ninguna otra acción. ¡Nos vemos allí!
              </p>

              ${conditionalBookingNoticeHtml}
              ${arriveEarlyNoticeHtml}
              ${bringItemsNoticeHtml}
              ${healthInsuranceNoticeHtml}

              ${buttonHtml}
              ${status !== 'cancelled' ? cancelButtonHtml : canceledButtonHtml}
              ${qrHtml}

              ${freeTourNoteHtml}

              ${legalNoticeHtml}
            </td>
          </tr>
          <!-- Footer band, matches the PDF's dark-green footer -->
          <tr>
            <td style="background-color: ${COLORS.forestDeep}; padding: 18px 24px; text-align: left;">
              <p style="margin: 0; font-size: 12px; font-style: italic; font-weight: 700; color: ${COLORS.cream};">
                Meriyo Tours Dublín
              </p>
              <p style="margin: 4px 0 0 0; font-size: 10px; color: ${COLORS.goldSoft};">
                &copy; ${new Date().getFullYear()} ${brandName}. Todos los derechos reservados.
                &nbsp;&middot;&nbsp;
                <a href="https://www.meriyotoursdublin.com/politicas-privacidad" style="color: ${COLORS.goldSoft};">Política de privacidad</a>
              </p>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `

    const attachments = [
      { filename: 'logo.png', content: LOGO_BUFFER, cid: 'brandlogo' }
    ]
    if (mapBuffer) attachments.push({ filename: 'meeting-point-map.png', content: mapBuffer, cid: 'meetingpointmap' })
    if (qrBuffer) attachments.push({ filename: 'manage-booking-qr.png', content: qrBuffer, cid: 'manageqrcode' })

    if (!transport) {
      fastify.log.warn({ email, ticket }, 'DEV MODE: booking ticket (not emailed, SMTP not configured)')
      return { delivered: false }
    }

    try {
      await transport.sendMail({
        from: config.smtpFrom,
        to: email,
        bcc: config.reticketsEmail || undefined,
        subject,
        text,
        html,
        attachments
      })
      return { delivered: true }
    } catch (err) {
      fastify.log.error({ err, email, bookingId }, 'Failed to send booking ticket email')
      return { delivered: false, error: err.message }
    }
  })
})