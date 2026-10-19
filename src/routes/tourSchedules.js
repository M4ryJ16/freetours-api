// Registered with prefix '/tours', so final paths are
// /tours/:tourId/schedules ...

export default async function tourScheduleRoutes(fastify) {
  const { pg } = fastify

  // Only active schedules are listed (same as GET /:tourId/dates).
  fastify.get('/:tourId/schedules', async (request, reply) => {
    const { tourId } = request.params

    const tour = await pg.query('SELECT id FROM tours WHERE id = $1', [tourId])
    if (!tour.rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
    }

    const { rows } = await pg.query(
      'SELECT * FROM tour_schedules WHERE tour_id = $1 AND is_active = true ORDER BY time ASC',
      [tourId]
    )
    return rows
  })

  // Read-only availability check for a specific tour_date + departure
  // schedule. Used by the frontend to show/limit remaining spots *before*
  // the user submits a booking. This does NOT lock anything — the
  // authoritative check (with row locking) still happens in
  // POST /bookings. A 200 here is a best-effort hint, not a guarantee the
  // spot will still be free by the time the booking is actually
  // submitted.
  fastify.get('/:tourId/availability', {
    schema: {
      querystring: {
        type: 'object',
        required: ['dateId', 'scheduleId'],
        properties: {
          dateId: { type: 'string', format: 'uuid' },
          scheduleId: { type: 'string', format: 'uuid' }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { tourId } = request.params
    const { dateId, scheduleId } = request.query

    const tour = await pg.query('SELECT capacity, is_active FROM tours WHERE id = $1', [tourId])
    if (!tour.rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
    }

    const date = await pg.query(
      'SELECT id, date FROM tour_dates WHERE id = $1 AND tour_id = $2 AND is_active = true',
      [dateId, tourId]
    )
    if (!date.rows.length) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'dateId does not match an available date for this tour.'
      })
    }

    const schedule = await pg.query(
      'SELECT id FROM tour_schedules WHERE id = $1 AND tour_id = $2 AND is_active = true',
      [scheduleId, tourId]
    )
    if (!schedule.rows.length) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'scheduleId does not match an available schedule for this tour.'
      })
    }

    const { capacity, is_active } = tour.rows[0]

    // Only adults (quantity) count against capacity; children, babies,
    // and pets don't (see bookings.js for the same rule at booking time).
    const booked = await pg.query(
      `SELECT COALESCE(SUM(quantity), 0)::int AS total
      FROM bookings
      WHERE tour_id = $1 AND tour_date_id = $2 AND tour_schedule_id = $3
        AND status NOT IN ('cancelled')`,
      [tourId, dateId, scheduleId]
    )
    const alreadyBooked = booked.rows[0].total
    const remaining = capacity === null ? null : Math.max(capacity - alreadyBooked, 0)

    return {
      tourId,
      scheduleId,
      dateId,
      date: date.rows[0].date,
      isActive: is_active,
      capacity,
      booked: alreadyBooked,
      remaining
    }
  })

  fastify.post('/:tourId/schedules', {
    preHandler: fastify.requirePublishKey,
    schema: {
      body: {
        type: 'object',
        required: ['time'],
        properties: {
          // 24h time, e.g. "05:30" or "05:30:00"
          time: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$' }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { tourId } = request.params
    const { time } = request.body

    const tour = await pg.query('SELECT id FROM tours WHERE id = $1', [tourId])
    if (!tour.rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
    }

    try {
      const { rows } = await pg.query(
        'INSERT INTO tour_schedules (time, tour_id) VALUES ($1, $2) RETURNING *',
        [time, tourId]
      )
      reply.code(201)
      return rows[0]
    } catch (err) {
      if (err.code === '23505') {
        // The time already exists. If it was previously deactivated,
        // re-open it instead of reporting a conflict.
        const { rows } = await pg.query(
          `UPDATE tour_schedules SET is_active = true
           WHERE tour_id = $1 AND time = $2 AND is_active = false
           RETURNING *`,
          [tourId, time]
        )
        if (rows.length) {
          return rows[0]
        }
        return reply.code(409).send({ error: 'Conflict', message: 'That departure time already exists.' })
      }
      throw err
    }
  })

  // Hard-deletes the schedule if nothing references it yet. If bookings
  // already exist for it (FK from bookings.tour_schedule_id blocks the
  // delete), it's deactivated instead — same soft-archive pattern as
  // tour_dates — so booking history stays intact and the schedule just
  // stops showing up as available.
  fastify.delete('/:tourId/schedules/:scheduleId', { preHandler: fastify.requirePublishKey }, async (request, reply) => {
    const { tourId, scheduleId } = request.params
    try {
      const { rows } = await pg.query(
        'DELETE FROM tour_schedules WHERE id = $1 AND tour_id = $2 RETURNING id',
        [scheduleId, tourId]
      )
      if (!rows.length) {
        return reply.code(404).send({ error: 'Not Found', message: 'Schedule not found.' })
      }
      return { message: 'Schedule removed.' }
    } catch (err) {
      if (err.code === '23503') {
        const { rows } = await pg.query(
          'UPDATE tour_schedules SET is_active = false WHERE id = $1 AND tour_id = $2 RETURNING *',
          [scheduleId, tourId]
        )
        if (!rows.length) {
          return reply.code(404).send({ error: 'Not Found', message: 'Schedule not found.' })
        }
        return { message: 'This schedule has existing bookings — deactivated instead of deleted.', schedule: rows[0] }
      }
      throw err
    }
  })
}