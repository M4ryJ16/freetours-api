// Registered with prefix '/tours', so final paths are
// /tours/:tourId/booking-settings
//
// Register it next to the other tour routes, e.g.:
//   fastify.register(tourBookingSettingsRoutes, { prefix: '/tours' })
//
// The only setting is `cutoffEnabled`:
//   true  -> the frontend keeps hiding departures that start in less than
//            its BOOKING_CUTOFF_MINUTES margin (default behaviour).
//   false -> the margin is ignored for this tour.
// A tour with no row is treated as cutoffEnabled = true.

export default async function tourBookingSettingsRoutes(fastify) {
  const { pg } = fastify

  // Public (x-api-key only): the booking page queries this per tour.
  fastify.get('/:tourId/booking-settings', {
    schema: {
      params: {
        type: 'object',
        properties: { tourId: { type: 'string', format: 'uuid' } }
      }
    }
  }, async (request, reply) => {
    const { tourId } = request.params

    const tour = await pg.query('SELECT id FROM tours WHERE id = $1', [tourId])
    if (!tour.rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
    }

    const { rows } = await pg.query(
      'SELECT cutoff_enabled FROM tour_booking_settings WHERE tour_id = $1',
      [tourId]
    )

    return {
      tourId,
      cutoffEnabled: rows.length ? rows[0].cutoff_enabled : true
    }
  })

  // Admin only: enable/disable the cutoff for one tour (upsert).
  fastify.put('/:tourId/booking-settings', {
    preHandler: fastify.requirePublishKey,
    schema: {
      params: {
        type: 'object',
        properties: { tourId: { type: 'string', format: 'uuid' } }
      },
      body: {
        type: 'object',
        required: ['cutoffEnabled'],
        properties: { cutoffEnabled: { type: 'boolean' } },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { tourId } = request.params
    const { cutoffEnabled } = request.body

    const tour = await pg.query('SELECT id FROM tours WHERE id = $1', [tourId])
    if (!tour.rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
    }

    const { rows } = await pg.query(
      `INSERT INTO tour_booking_settings (tour_id, cutoff_enabled)
       VALUES ($1, $2)
       ON CONFLICT (tour_id) DO UPDATE SET cutoff_enabled = EXCLUDED.cutoff_enabled
       RETURNING tour_id, cutoff_enabled`,
      [tourId, cutoffEnabled]
    )

    return { tourId: rows[0].tour_id, cutoffEnabled: rows[0].cutoff_enabled }
  })
}

// Admin list: one row per tour with its effective flag. Registered with
// prefix '/booking-settings' -> GET /booking-settings
export async function bookingSettingsListRoutes(fastify) {
  const { pg } = fastify

  fastify.get('/', { preHandler: fastify.requirePublishKey }, async () => {
    const { rows } = await pg.query(
      `SELECT t.id AS tour_id, t.name, t.is_active,
              COALESCE(s.cutoff_enabled, true) AS cutoff_enabled
       FROM tours t
       LEFT JOIN tour_booking_settings s ON s.tour_id = t.id
       ORDER BY t.name ASC`
    )
    return rows.map((r) => ({
      tourId: r.tour_id,
      name: r.name,
      isActive: r.is_active,
      cutoffEnabled: r.cutoff_enabled
    }))
  })
}