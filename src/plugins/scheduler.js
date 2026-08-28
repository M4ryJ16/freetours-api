import fp from 'fastify-plugin'
import cron from 'node-cron'
import { config } from '#config/env.js'
import { runDailyReservationsSummary } from '#services/dailySummaryJob.js'

export default fp(async function schedulerPlugin(fastify) {
  if (!config.summaryEmail) {
    fastify.log.warn(
      'SUMMARY_EMAIL is not configured — the daily reservations summary email job is disabled. ' +
      'Set SUMMARY_EMAIL (and optionally SUMMARY_EMAIL_TZ / SUMMARY_EMAIL_RANGE_DAYS) to enable it.'
    )
    return
  }

  const runJob = () => {
    runDailyReservationsSummary(fastify)
      .then((result) => fastify.log.info(result, 'Daily reservations summary email job finished'))
      .catch((err) => fastify.log.error({ err }, 'Failed to run daily reservations summary job'))
  }

  // Se envía dos veces al día: a las 8:00 y a las 11:00, en la zona
  // horaria configurada (SUMMARY_EMAIL_TZ).
  const morningTask = cron.schedule('0 8 * * *', runJob, { timezone: config.summaryEmailTimezone })
  const midMorningTask = cron.schedule('0 11 * * *', runJob, { timezone: config.summaryEmailTimezone })

  fastify.addHook('onClose', () => {
    morningTask.stop()
    midMorningTask.stop()
  })

  fastify.log.info(
    { timezone: config.summaryEmailTimezone, to: config.summaryEmail, times: ['08:00', '11:00'] },
    'Daily reservations summary email job scheduled for 08:00 and 11:00'
  )
})