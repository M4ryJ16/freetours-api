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

  // Las horas de envío se leen de SUMMARY_EMAIL_TIMES (formato HH:MM,
  // separadas por comas) en la zona horaria SUMMARY_EMAIL_TZ.
  const times = config.summaryEmailTimes.map((t) => t.label)
  const tasks = config.summaryEmailTimes.map(({ hour, minute }) =>
    cron.schedule(`${minute} ${hour} * * *`, runJob, { timezone: config.summaryEmailTimezone })
  )

  fastify.addHook('onClose', () => {
    for (const task of tasks) task.stop()
  })

  fastify.log.info(
    { timezone: config.summaryEmailTimezone, to: config.summaryEmail, times },
    `Daily reservations summary email job scheduled for ${times.join(', ')}`
  )
})
