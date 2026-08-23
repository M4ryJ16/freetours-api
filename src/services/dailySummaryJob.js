import { config } from '#config/env.js'
import { getReservationsSummary } from '#services/reservationsSummary.js'

// Computes today's date (YYYY-MM-DD) in a given IANA timezone.
function todayIsoInTz(timezone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
}

function addDaysToIsoDate(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// Runs the same "today → N days ahead" reservations summary used by the
// midnight cron job (plugins/scheduler.js) and by the admin panel's
// manual "send now" button (POST /bookings/summary/send). Throws if
// SUMMARY_EMAIL isn't configured — callers decide how to surface that.
export async function runDailyReservationsSummary(fastify) {
  if (!config.summaryEmail) {
    throw new Error('SUMMARY_EMAIL is not configured.')
  }

  const dateFrom = todayIsoInTz(config.summaryEmailTimezone)
  const dateTo = addDaysToIsoDate(dateFrom, config.summaryEmailRangeDays)

  const rows = await getReservationsSummary(fastify.pg, { dateFrom, dateTo })
  const result = await fastify.sendReservationsSummaryEmail(config.summaryEmail, { dateFrom, dateTo, rows })

  return { dateFrom, dateTo, rowCount: rows.length, delivered: result.delivered, error: result.error }
}