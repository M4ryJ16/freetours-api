// Registered with prefix '/tours', so final paths are
// /tours/:tourId/schedules ...

export default async function tourScheduleRoutes(fastify) {
  const { pg } = fastify

  fastify.get('/:tourId/schedules', async (request, reply) => {
    const { tourId } = request.params

    const tour = await pg.query('SELECT id FROM tours WHERE id = $1', [tourId])
    if (!tour.rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
    }

    const { rows } = await pg.query(
      'SELECT * FROM tour_schedules WHERE tour_id = $1 ORDER BY time ASC',
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
      'SELECT id FROM tour_schedules WHERE id = $1 AND tour_id = $2',
      [scheduleId, tourId]
    )
    if (!schedule.rows.length) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'scheduleId does not match a schedule for this tour.'
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
        return reply.code(409).send({ error: 'Conflict', message: 'That departure time already exists.' })
      }
      throw err
    }
  })

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
        // FK from bookings.tour_schedule_id — can't delete a schedule that's already booked.
        return reply.code(409).send({
          error: 'Conflict',
          message: 'This schedule has existing bookings and cannot be deleted.'
        })
      }
      throw err
    }
  })
}
