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

  const task = cron.schedule('0 0 * * *', () => {
    runDailyReservationsSummary(fastify)
      .then((result) => fastify.log.info(result, 'Daily reservations summary email job finished'))
      .catch((err) => fastify.log.error({ err }, 'Failed to run daily reservations summary job'))
  }, { timezone: config.summaryEmailTimezone })

  fastify.addHook('onClose', () => {
    task.stop()
  })

  fastify.log.info(
    { timezone: config.summaryEmailTimezone, to: config.summaryEmail },
    'Daily reservations summary email job scheduled for midnight'
  )
})