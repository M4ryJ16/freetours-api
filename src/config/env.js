import 'dotenv/config'

function required(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function optional(name, fallback = undefined) {
  return process.env[name] ?? fallback
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: required('DATABASE_URL'),
  apiKey: required('API_KEY'),
  publishKey: required('PUBLISH_KEY'),

  // Image uploads — where saved files live on disk, the max accepted
  // size, and (optionally) the public origin used to build served URLs.
  // If PUBLIC_BASE_URL is unset, it's derived per-request from the
  // incoming request's protocol/host instead.
  uploadDir: optional('UPLOAD_DIR', './uploads'),
  maxUploadBytes: Number(optional('MAX_UPLOAD_BYTES', 5 * 1024 * 1024)), // 5 MB default
  publicBaseUrl: optional('PUBLIC_BASE_URL'),

  // Auth — instant registration/login (no email confirmation code), just
  // a JWT session once a customer record exists.
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: optional('JWT_EXPIRES_IN', '7d'),

  // SMTP — used to email the customer their tour-registration ticket
  // right after a booking is created. If SMTP_HOST is unset, the mailer
  // plugin falls back to logging the ticket instead of sending it
  // (useful for local dev without an SMTP provider configured).
  smtpHost: optional('SMTP_HOST'),
  smtpPort: Number(optional('SMTP_PORT', 587)),
  smtpSecure: optional('SMTP_SECURE', 'false') === 'true',
  smtpUser: optional('SMTP_USER'),
  smtpPass: optional('SMTP_PASS'),
  smtpFrom: optional('SMTP_FROM', 'no-reply@example.com'),

  // OpenStreetMap — used to render a static map image of the tour's
  // meeting point inside booking ticket emails, instead of writing the
  // address out as text. No API key or billing account needed.
  //
  // OSM_TILE_URL lets you point at a different tile provider (a
  // self-hosted server, or a commercial OSM-tile host like Stadia Maps /
  // Thunderforest / MapTiler) instead of the public
  // tile.openstreetmap.org servers. Their usage policy
  // (https://operations.osmfoundation.org/policies/tiles/) asks that
  // heavy automated/production traffic NOT be sent to the public
  // servers — fine for light volume, worth switching for anything more.
  //
  // OSM_TILE_USER_AGENT sets the identifying User-Agent header tile
  // servers require every client to send.
  osmTileUrl: optional('OSM_TILE_URL', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
  osmTileUserAgent: optional('OSM_TILE_USER_AGENT', 'tours-meriyo-dublin/1.0 (contact: no-reply@example.com)'),

  // The full URL of the page (frontend) where a customer can view, edit,
  // or cancel their own booking. The booking id is appended to the end
  // of this URL to build both the QR code and the plain-text fallback
  // link sent in the ticket email. Example:
  //   MANAGE_BOOKING_URL=https://example.com/my-booking
  //   -> https://example.com/my-booking/<bookingId>
  // If unset, the mailer skips the QR code and manage link.
  manageBookingUrl: optional('MANAGE_BOOKING_URL'),

  // Daily reservations summary email — sent every midnight (server-side
  // cron, see plugins/scheduler.js) with the same "current day + N days
  // ahead" filter as the admin Reservas panel's default view. If
  // SUMMARY_EMAIL is unset, the job is disabled (logged once at startup).
  summaryEmail: optional('SUMMARY_EMAIL'),
  // IANA timezone the "midnight" trigger and the "today" date are
  // computed in — should match where the tours actually run, not
  // necessarily where the server is hosted.
  summaryEmailTimezone: optional('SUMMARY_EMAIL_TZ', 'Europe/Dublin'),
  // How many days ahead of today the summary covers.
  summaryEmailRangeDays: Number(optional('SUMMARY_EMAIL_RANGE_DAYS', 30)),
}