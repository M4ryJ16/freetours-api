import path from 'node:path'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { config } from './config/env.js'
import dbPlugin from './plugins/db.js'
import authPlugin from './plugins/auth.js'
import jwtPlugin from './plugins/jwt.js'
import mailerPlugin from './plugins/mailer.js'
import healthRoutes from './routes/health.js'
import tourRoutes from './routes/tours.js'
import tourScheduleRoutes from './routes/tourSchedules.js'
import tourDateRoutes from './routes/tourDates.js'
import tourStopRoutes from './routes/tourStops.js'
import galleryRoutes from './routes/gallery.js'
import imageRoutes from './routes/images.js'
import customerRoutes from './routes/customers.js'
import bookingRoutes from './routes/bookings.js'
import reviewRoutes from './routes/reviews.js'
import authRoutes from './routes/auth.js'
import i18nRoutes from './routes/i18n.js'
import schedulerPlugin from './plugins/scheduler.js'
import tourBookingSettingsRoutes, { bookingSettingsListRoutes } from './routes/bookingSettings.js'

const fastify = Fastify({ logger: true })

await fastify.register(cors)
await fastify.register(helmet, {
  crossOriginResourcePolicy: { policy: 'cross-origin' }
})
await fastify.register(dbPlugin)
await fastify.register(jwtPlugin)
await fastify.register(mailerPlugin)
await fastify.register(schedulerPlugin)
await fastify.register(multipart, {
  limits: {
    fileSize: config.maxUploadBytes,
    files: 1
  }
})

await fastify.register(fastifyStatic, {
  root: path.resolve(config.uploadDir),
  prefix: '/uploads/'
})

await fastify.register(healthRoutes)

await fastify.register(async (app) => {
  await app.register(authPlugin)

  await app.register(tourRoutes, { prefix: '/tours' })
  await app.register(tourScheduleRoutes, { prefix: '/tours' })
  await app.register(tourDateRoutes, { prefix: '/tours' })
  await app.register(tourStopRoutes, { prefix: '/tours' })
  await app.register(galleryRoutes, { prefix: '/tours' })
  await app.register(imageRoutes, { prefix: '/images' })
  await app.register(customerRoutes, { prefix: '/customers' })
  await app.register(bookingRoutes)
  await app.register(reviewRoutes)
  await app.register(authRoutes)
  await app.register(tourBookingSettingsRoutes, { prefix: '/tours' })
  await app.register(bookingSettingsListRoutes, { prefix: '/booking-settings' })
  await app.register(i18nRoutes)
})

fastify.setErrorHandler((error, request, reply) => {
  if (error.validation) {
    reply.code(400).send({ error: 'Bad Request', message: error.message })
    return
  }
  if (error.code === 'FST_REQ_FILE_TOO_LARGE') {
    reply.code(413).send({ error: 'Payload Too Large', message: 'Uploaded file exceeds the size limit.' })
    return
  }
  request.log.error(error)
  reply.code(500).send({ error: 'Internal Server Error', message: 'Something went wrong.' })
})

try {
  await fastify.listen({ port: config.port, host: config.host })
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
