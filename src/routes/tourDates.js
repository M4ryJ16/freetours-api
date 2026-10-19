// Registered with prefix '/tours', so final paths are
// /tours/:tourId/dates ...
//
// These are the calendar dates a tour is actually offered on — bookings
// must reference one of these via tour_date_id, the same way they must
// reference a tour_schedules row for the departure time. See
// tables/tour_dates.sql.

export default async function tourDateRoutes(fastify) {
  const { pg } = fastify

  fastify.get('/:tourId/dates', async (request, reply) => {
    const { tourId } = request.params

    const tour = await pg.query('SELECT id FROM tours WHERE id = $1', [tourId])
    if (!tour.rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
    }

    const { rows } = await pg.query(
      'SELECT * FROM tour_dates WHERE tour_id = $1 AND is_active = true ORDER BY date ASC',
      [tourId]
    )
    return rows
  })

  fastify.post('/:tourId/dates', {
    preHandler: fastify.requirePublishKey,
    schema: {
      body: {
        type: 'object',
        required: ['date'],
        properties: {
          date: { type: 'string', format: 'date' }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { tourId } = request.params
    const { date } = request.body

    const tour = await pg.query('SELECT id FROM tours WHERE id = $1', [tourId])
    if (!tour.rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
    }

    try {
      const { rows } = await pg.query(
        'INSERT INTO tour_dates (tour_id, date) VALUES ($1, $2) RETURNING *',
        [tourId, date]
      )
      reply.code(201)
      return rows[0]
    } catch (err) {
      if (err.code === '23505') {
        // The date already exists (UNIQUE (tour_id, date)). If it was
        // previously deactivated, re-open it instead of reporting a conflict.
        const { rows } = await pg.query(
          `UPDATE tour_dates SET is_active = true
           WHERE tour_id = $1 AND date = $2 AND is_active = false
           RETURNING *`,
          [tourId, date]
        )
        if (rows.length) {
          return rows[0]
        }
        return reply.code(409).send({ error: 'Conflict', message: 'That date is already available for this tour.' })
      }
      throw err
    }
  })

  // Hard-deletes the date if nothing references it yet. If bookings
  // already exist for it (FK from bookings.tour_date_id blocks the
  // delete), it's deactivated instead — same soft-archive pattern as
  // tours.is_active — so booking history stays intact and the date just
  // stops showing up as available.
  fastify.delete('/:tourId/dates/:dateId', { preHandler: fastify.requirePublishKey }, async (request, reply) => {
    const { tourId, dateId } = request.params

    try {
      const { rows } = await pg.query(
        'DELETE FROM tour_dates WHERE id = $1 AND tour_id = $2 RETURNING id',
        [dateId, tourId]
      )
      if (!rows.length) {
        return reply.code(404).send({ error: 'Not Found', message: 'Date not found.' })
      }
      return { message: 'Date removed.' }
    } catch (err) {
      if (err.code === '23503') {
        const { rows } = await pg.query(
          'UPDATE tour_dates SET is_active = false WHERE id = $1 AND tour_id = $2 RETURNING *',
          [dateId, tourId]
        )
        if (!rows.length) {
          return reply.code(404).send({ error: 'Not Found', message: 'Date not found.' })
        }
        return { message: 'This date has existing bookings — deactivated instead of deleted.', date: rows[0] }
      }
      throw err
    }
  })
}