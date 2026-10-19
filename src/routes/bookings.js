import { getReservationsSummary } from '#services/reservationsSummary.js'
import { runDailyReservationsSummary } from '#services/dailySummaryJob.js'
import { DEFAULT_LANG } from '#services/translator.js'

// Optional ?lang=<code> on every route that emails a ticket to the
// customer. Defaults to Spanish ('es'); any other value (e.g. 'en', 'fr',
// 'pt-BR') makes the ticket get translated — see services/translator.js.
const langQuerySchema = {
  type: 'object',
  properties: {
    lang: { type: 'string', pattern: '^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$', default: DEFAULT_LANG }
  },
  additionalProperties: false
}

// Loads the fields needed to (re)send a booking's ticket email: tour
// name, meeting-point coordinates (used to render the map image — see
// plugins/mailer.js), the booked calendar date, departure time, and the
// customer's name/email.
async function loadBookingEmailDetails(pg, bookingId) {
  const { rows } = await pg.query(
    `SELECT t.name AS tour_name, t.meeting_point_lat, t.meeting_point_lng,
            td.date AS tour_date, ts.time AS departure_time,
            c.full_name AS customer_name, c.email AS customer_email
     FROM bookings b
     JOIN tours t ON t.id = b.tour_id
     JOIN tour_dates td ON td.id = b.tour_date_id
     JOIN tour_schedules ts ON ts.id = b.tour_schedule_id
     JOIN customers c ON c.id = b.customer_id
     WHERE b.id = $1`,
    [bookingId]
  )
  return rows[0]
}

function buildTicket(booking, info) {
  return {
    bookingId: booking.id,
    status: booking.status,
    customerName: info.customer_name,
    tourName: info.tour_name,
    tourDate: info.tour_date,
    departureTime: info.departure_time,
    quantity: booking.quantity,
    numberOfChildren: booking.number_of_children,
    numberOfBabies: booking.number_of_babies,
    numberOfPets: booking.number_of_pets,
    meetingPointLat: info.meeting_point_lat,
    meetingPointLng: info.meeting_point_lng
  }
}

export default async function bookingRoutes(fastify) {
  const { pg } = fastify

  fastify.post('/bookings', {
  schema: {
    querystring: langQuerySchema,
    body: {
      type: 'object',
      required: ['customerId', 'tourId', 'tourDateId', 'tourScheduleId'],
      properties: {
        customerId: { type: 'string', format: 'uuid' },
        tourId: { type: 'string', format: 'uuid' },
        tourDateId: { type: 'string', format: 'uuid' },
        tourScheduleId: { type: 'string', format: 'uuid' },
        quantity: { type: 'integer', minimum: 1 },
        numberOfChildren: { type: 'integer', minimum: 0 },
        numberOfBabies: { type: 'integer', minimum: 0 },
        numberOfPets: { type: 'integer', minimum: 0 }
      },
      additionalProperties: false
    }
  }
  }, async (request, reply) => {
    const {
      customerId, tourId, tourDateId, tourScheduleId,
      quantity = 1, numberOfChildren = 0, numberOfBabies = 0, numberOfPets = 0
    } = request.body
    const { lang = DEFAULT_LANG } = request.query

    const client = await pg.connect()
    try {
      await client.query('BEGIN')

      // Lock the tour row for the duration of this transaction. This is
      // what actually prevents overbooking under concurrency: two
      // simultaneous requests for the same tour will serialize here —
      // the second one blocks until the first commits/rolls back, so
      // its capacity check below sees the first booking's quantity.
      const tour = await client.query(
        'SELECT capacity, is_active FROM tours WHERE id = $1 FOR UPDATE',
        [tourId]
      )
      if (!tour.rows.length) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
      }
      if (!tour.rows[0].is_active) {
        await client.query('ROLLBACK')
        return reply.code(409).send({ error: 'Conflict', message: 'This tour is not currently available.' })
      }

      // Make sure the chosen date and schedule actually belong to this
      // tour and are still active — the FK alone would happily accept a
      // valid tour_dates / tour_schedules id that belongs to a different
      // tour, or one that has been deactivated.
      const date = await client.query(
        'SELECT id FROM tour_dates WHERE id = $1 AND tour_id = $2 AND is_active = true',
        [tourDateId, tourId]
      )
      if (!date.rows.length) {
        await client.query('ROLLBACK')
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'tourDateId does not match an available date for this tour.'
        })
      }

      const schedule = await client.query(
        'SELECT id FROM tour_schedules WHERE id = $1 AND tour_id = $2 AND is_active = true',
        [tourScheduleId, tourId]
      )
      if (!schedule.rows.length) {
        await client.query('ROLLBACK')
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'tourScheduleId does not match an available schedule for this tour.'
        })
      }

      const partySize = quantity

      const capacity = tour.rows[0].capacity
      if (capacity !== null) {
        // Sum adults already booked for this exact departure (same tour,
        // date, and schedule). Cancelled bookings don't hold a spot.
        const booked = await client.query(
          `SELECT COALESCE(SUM(quantity), 0)::int AS total
          FROM bookings
          WHERE tour_id = $1 AND tour_date_id = $2 AND tour_schedule_id = $3
            AND status NOT IN ('cancelled')`,
          [tourId, tourDateId, tourScheduleId]
        )
        const alreadyBooked = booked.rows[0].total
        const remaining = capacity - alreadyBooked

        if (partySize > remaining) {
          await client.query('ROLLBACK')
          return reply.code(409).send({
            error: 'Conflict',
            message: remaining > 0
              ? `Only ${remaining} spot(s) left for this departure.`
              : 'This departure is fully booked.',
            capacity,
            alreadyBooked,
            remaining: Math.max(remaining, 0)
          })
        }
      }

      let bookingRow
      try {
        const { rows } = await client.query(
          `INSERT INTO bookings (customer_id, tour_id, tour_date_id, tour_schedule_id, quantity, number_of_children, number_of_babies, number_of_pets)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *`,
          [customerId, tourId, tourDateId, tourScheduleId, quantity, numberOfChildren, numberOfBabies, numberOfPets]
        )
        bookingRow = rows[0]
      } catch (err) {
        if (err.code === '23503') {
          await client.query('ROLLBACK')
          return reply.code(404).send({ error: 'Not Found', message: 'Customer not found.' })
        }
        throw err
      }

      await client.query('COMMIT')

      // Email the customer their ticket now that the booking is durable.
      // Best-effort: a delivery failure shouldn't undo a valid booking —
      // it's just surfaced back on the response so the caller can decide
      // whether to show the ticket details on-screen as a fallback.
      let ticketEmail = { delivered: false }
      try {
        const info = await loadBookingEmailDetails(pg, bookingRow.id)
        ticketEmail = await fastify.sendBookingTicket(info.customer_email, buildTicket(bookingRow, info), lang)
      } catch (err) {
        request.log.error({ err, bookingId: bookingRow.id }, 'Failed to send booking ticket email')
      }

      reply.code(201)
      return { ...bookingRow, ticketEmailDelivered: ticketEmail.delivered }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // Manual trigger for the daily reservations summary email — same job
  // the midnight cron runs (plugins/scheduler.js), exposed so an admin can
  // send it on demand (e.g. to check it arrived, or to get an extra copy
  // mid-day) without waiting for the schedule.
  fastify.post('/bookings/summary/send', { preHandler: fastify.requirePublishKey }, async (request, reply) => {
    try {
      const result = await runDailyReservationsSummary(fastify)
      if (!result.delivered) {
        return reply.code(502).send({
          error: 'Bad Gateway',
          message: result.error || 'The summary was generated but the email could not be delivered.',
          ...result
        })
      }
      return result
    } catch (err) {
      if (err.message === 'SUMMARY_EMAIL is not configured.') {
        return reply.code(400).send({ error: 'Bad Request', message: err.message })
      }
      throw err
    }
  })

  // ----------------------------------------------------------------------
  // Admin: aggregated reservation counts per tour + calendar date +
  // departure time. Powers the admin "Reservas" panel — one row per
  // (tour, date, time) with how many bookings, and the summed party
  // composition (adults/children/babies/pets) across them.
  // Cancelled bookings are excluded by default (pass includeCancelled=true
  // to include them).
  // ----------------------------------------------------------------------
  fastify.get('/bookings/summary', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          tourId: { type: 'string', format: 'uuid' },
          dateFrom: { type: 'string', format: 'date' },
          dateTo: { type: 'string', format: 'date' },
          timeFrom: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$' },
          timeTo: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$' },
          includeCancelled: { type: 'boolean' }
        },
        additionalProperties: false
      }
    }
  }, async (request) => {
    return getReservationsSummary(pg, request.query)
  })

  fastify.get('/bookings/:id', async (request, reply) => {
    const { rows } = await pg.query(
      `SELECT b.*, t.name AS tour_name, td.date AS tour_date, ts.time AS departure_time,
              c.full_name AS customer_name, c.email AS customer_email
       FROM bookings b
       JOIN tours t ON t.id = b.tour_id
       JOIN tour_dates td ON td.id = b.tour_date_id
       JOIN tour_schedules ts ON ts.id = b.tour_schedule_id
       JOIN customers c ON c.id = b.customer_id
       WHERE b.id = $1`,
      [request.params.id]
    )
    if (!rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Booking not found.' })
    }
    return rows[0]
  })

  // ----------------------------------------------------------------------
  // Customer self-service: edit a booking's date/schedule/party size.
  // No login required — anyone with the booking id (from the ticket
  // email / manage link) can edit it, same model as GET /bookings/:id
  // below. Re-runs the same row-locked capacity check as POST /bookings,
  // excluding this booking's own currently-held spots so editing
  // quantity down (or keeping the same date/schedule) doesn't get
  // wrongly blocked by itself.
  //
  // A date/schedule is only required to be active when the customer is
  // *moving* to it. A booking that keeps its current date/schedule can
  // still be edited (e.g. party size) even if that date/schedule has
  // since been deactivated.
  // ----------------------------------------------------------------------
  fastify.patch('/bookings/:id', {
    schema: {
      querystring: langQuerySchema,
      body: {
        type: 'object',
        minProperties: 1,
        properties: {
          tourDateId: { type: 'string', format: 'uuid' },
          tourScheduleId: { type: 'string', format: 'uuid' },
          quantity: { type: 'integer', minimum: 1 },
          numberOfChildren: { type: 'integer', minimum: 0 },
          numberOfBabies: { type: 'integer', minimum: 0 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { id } = request.params
    const { lang = DEFAULT_LANG } = request.query
    const client = await pg.connect()
    try {
      await client.query('BEGIN')

      const existing = await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [id])
      if (!existing.rows.length) {
        await client.query('ROLLBACK')
        return reply.code(404).send({ error: 'Not Found', message: 'Booking not found.' })
      }
      const booking = existing.rows[0]

      if (['cancelled', 'completed'].includes(booking.status)) {
        await client.query('ROLLBACK')
        return reply.code(409).send({
          error: 'Conflict',
          message: `This booking is ${booking.status} and can no longer be edited.`
        })
      }

      const tourDateId = request.body.tourDateId ?? booking.tour_date_id
      const tourScheduleId = request.body.tourScheduleId ?? booking.tour_schedule_id
      const quantity = request.body.quantity ?? booking.quantity
      const numberOfChildren = request.body.numberOfChildren ?? booking.number_of_children
      const numberOfBabies = request.body.numberOfBabies ?? booking.number_of_babies
      const numberOfPets = request.body.numberOfPets ?? booking.number_of_pets

      const tour = await client.query('SELECT capacity, is_active FROM tours WHERE id = $1 FOR UPDATE', [booking.tour_id])
      if (!tour.rows[0].is_active) {
        await client.query('ROLLBACK')
        return reply.code(409).send({ error: 'Conflict', message: 'This tour is not currently available.' })
      }

      if (tourDateId !== booking.tour_date_id) {
        const date = await client.query(
          'SELECT id FROM tour_dates WHERE id = $1 AND tour_id = $2 AND is_active = true',
          [tourDateId, booking.tour_id]
        )
        if (!date.rows.length) {
          await client.query('ROLLBACK')
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'tourDateId does not match an available date for this tour.'
          })
        }
      }

      if (tourScheduleId !== booking.tour_schedule_id) {
        const schedule = await client.query(
          'SELECT id FROM tour_schedules WHERE id = $1 AND tour_id = $2 AND is_active = true',
          [tourScheduleId, booking.tour_id]
        )
        if (!schedule.rows.length) {
          await client.query('ROLLBACK')
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'tourScheduleId does not match an available schedule for this tour.'
          })
        }
      }

      const partySize = quantity
      const capacity = tour.rows[0].capacity
      if (capacity !== null) {
        const booked = await client.query(
          `SELECT COALESCE(SUM(quantity), 0)::int AS total
          FROM bookings
          WHERE tour_id = $1 AND tour_date_id = $2 AND tour_schedule_id = $3
            AND status NOT IN ('cancelled') AND id != $4`,
          [booking.tour_id, tourDateId, tourScheduleId, id]
        )
        const alreadyBooked = booked.rows[0].total
        const remaining = capacity - alreadyBooked

        if (partySize > remaining) {
          await client.query('ROLLBACK')
          return reply.code(409).send({
            error: 'Conflict',
            message: remaining > 0
              ? `Only ${remaining} spot(s) left for this departure.`
              : 'This departure is fully booked.',
            capacity,
            alreadyBooked,
            remaining: Math.max(remaining, 0)
          })
        }
      }

      const { rows } = await client.query(
        `UPDATE bookings
        SET tour_date_id = $1, tour_schedule_id = $2, quantity = $3, number_of_children = $4, number_of_babies = $5, number_of_pets = $6
        WHERE id = $7
        RETURNING *`,
        [tourDateId, tourScheduleId, quantity, numberOfChildren, numberOfBabies, numberOfPets, id]
      )
      await client.query('COMMIT')

      const updated = rows[0]

      let ticketEmail = { delivered: false }
      try {
        const info = await loadBookingEmailDetails(pg, updated.id)
        ticketEmail = await fastify.sendBookingTicket(info.customer_email, buildTicket(updated, info), lang)
      } catch (err) {
        request.log.error({ err, bookingId: updated.id }, 'Failed to send updated booking ticket email')
      }

      return { ...updated, ticketEmailDelivered: ticketEmail.delivered }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // ----------------------------------------------------------------------
  // Customer self-service: cancel a booking. No login required — same
  // "anyone with the booking id" model as the PATCH above. Soft-cancel
  // only (status flip), same as the admin status endpoint below, so
  // booking/review history stays intact.
  // ----------------------------------------------------------------------
  fastify.delete('/bookings/:id', { schema: { querystring: langQuerySchema } }, async (request, reply) => {
    const { id } = request.params
    const { lang = DEFAULT_LANG } = request.query

    const existing = await pg.query('SELECT * FROM bookings WHERE id = $1', [id])
    if (!existing.rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Booking not found.' })
    }
    const booking = existing.rows[0]

    if (booking.status === 'cancelled') {
      return reply.code(409).send({ error: 'Conflict', message: 'This booking is already cancelled.' })
    }
    if (booking.status === 'completed') {
      return reply.code(409).send({ error: 'Conflict', message: 'This booking is already completed and cannot be cancelled.' })
    }

    const { rows } = await pg.query(
      'UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *',
      ['cancelled', id]
    )
    const cancelled = rows[0]

    let ticketEmail = { delivered: false }
    try {
      const info = await loadBookingEmailDetails(pg, cancelled.id)
      ticketEmail = await fastify.sendBookingTicket(info.customer_email, buildTicket(cancelled, info), lang)
    } catch (err) {
      request.log.error({ err, bookingId: cancelled.id }, 'Failed to send cancellation email')
    }

    return { ...cancelled, ticketEmailDelivered: ticketEmail.delivered }
  })

  // Admin/staff-only: force a booking into any status (e.g. mark
  // confirmed/completed after the tour runs). Distinct from the
  // customer-facing PATCH/DELETE above, so it requires the publish key
  // rather than a customer session.
  fastify.patch('/bookings/:id/status', {
    preHandler: fastify.requirePublishKey,
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['pending', 'confirmed', 'cancelled', 'completed'] }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { rows } = await pg.query(
      'UPDATE bookings SET status = $1 WHERE id = $2 RETURNING *',
      [request.body.status, request.params.id]
    )
    if (!rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Booking not found.' })
    }
    return rows[0]
  })
}