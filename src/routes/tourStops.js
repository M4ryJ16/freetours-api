// Registered with prefix '/tours', so final paths are
// /tours/:tourId/stops ...
//
// Tour stops are intermediate waypoints along a tour's route — distinct
// from the single required meeting point on the tour itself
// (tours.meeting_point*), which is only where the tour begins. A tour can
// have any number of stops, each pinned to a specific location the same
// way the meeting point is: lat/lng required, plus an optional
// human-readable address-style name/description and an OSM id. See
// tables/tour_stops.sql.

const stopLocationSchema = {
  type: 'object',
  required: ['lat', 'lng'],
  properties: {
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
    osmId: { type: 'string', maxLength: 255 }
  },
  additionalProperties: false
}

const stopCreateSchema = {
  body: {
    type: 'object',
    required: ['name', 'location'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string' },
      location: stopLocationSchema,
      position: { type: 'integer', minimum: 0 }
    },
    additionalProperties: false
  }
}

const stopUpdateSchema = {
  body: {
    type: 'object',
    minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string' },
      location: stopLocationSchema,
      position: { type: 'integer', minimum: 0 }
    },
    additionalProperties: false
  }
}

export default async function tourStopRoutes(fastify) {
  const { pg } = fastify

  // Public — lists a tour's stops in visiting order.
  fastify.get('/:tourId/stops', async (request, reply) => {
    const { tourId } = request.params

    const tour = await pg.query('SELECT id FROM tours WHERE id = $1', [tourId])
    if (!tour.rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
    }

    const { rows } = await pg.query(
      'SELECT * FROM tour_stops WHERE tour_id = $1 ORDER BY position ASC',
      [tourId]
    )
    return rows
  })

  fastify.get('/:tourId/stops/:stopId', async (request, reply) => {
    const { tourId, stopId } = request.params
    const { rows } = await pg.query(
      'SELECT * FROM tour_stops WHERE id = $1 AND tour_id = $2',
      [stopId, tourId]
    )
    if (!rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Stop not found.' })
    }
    return rows[0]
  })

  // Publish-protected — adds a new stop to a tour's route. If `position`
  // is omitted, the stop is appended to the end of the current route.
  fastify.post('/:tourId/stops', {
    schema: stopCreateSchema,
    preHandler: fastify.requirePublishKey
  }, async (request, reply) => {
    const { tourId } = request.params
    const { name, description, location, position } = request.body

    const tour = await pg.query('SELECT id FROM tours WHERE id = $1', [tourId])
    if (!tour.rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
    }

    let resolvedPosition = position
    if (resolvedPosition === undefined) {
      const { rows } = await pg.query(
        'SELECT COALESCE(MAX(position) + 1, 0) AS next_position FROM tour_stops WHERE tour_id = $1',
        [tourId]
      )
      resolvedPosition = rows[0].next_position
    }

    const { rows } = await pg.query(
      `INSERT INTO tour_stops (tour_id, name, description, lat, lng, osm_id, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [tourId, name, description ?? null, location.lat, location.lng, location.osmId ?? null, resolvedPosition]
    )
    reply.code(201)
    return rows[0]
  })

  // Publish-protected — updates a stop's name/description/location, or
  // moves it within the route by changing its position.
  fastify.patch('/:tourId/stops/:stopId', {
    schema: stopUpdateSchema,
    preHandler: fastify.requirePublishKey
  }, async (request, reply) => {
    const { tourId, stopId } = request.params

    const sets = []
    const values = []

    if (request.body.location !== undefined) {
      const loc = request.body.location
      values.push(loc.lat); sets.push(`lat = $${values.length}`)
      values.push(loc.lng); sets.push(`lng = $${values.length}`)
      values.push(loc.osmId ?? null); sets.push(`osm_id = $${values.length}`)
    }

    const fieldMap = { name: 'name', description: 'description', position: 'position' }
    for (const [key, column] of Object.entries(fieldMap)) {
      if (request.body[key] !== undefined) {
        values.push(request.body[key])
        sets.push(`${column} = $${values.length}`)
      }
    }

    if (!sets.length) {
      return reply.code(400).send({ error: 'Bad Request', message: 'No updatable fields provided.' })
    }

    values.push(stopId, tourId)
    const { rows } = await pg.query(
      `UPDATE tour_stops SET ${sets.join(', ')} WHERE id = $${values.length - 1} AND tour_id = $${values.length} RETURNING *`,
      values
    )
    if (!rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Stop not found.' })
    }
    return rows[0]
  })

  // Publish-protected — reorders every stop of a tour in one call, so the
  // frontend can drag-and-drop the whole route and save it in one shot
  // instead of issuing one PATCH per stop.
  fastify.put('/:tourId/stops/order', {
    schema: {
      body: {
        type: 'object',
        required: ['order'],
        properties: {
          order: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            minItems: 1
          }
        },
        additionalProperties: false
      }
    },
    preHandler: fastify.requirePublishKey
  }, async (request, reply) => {
    const { tourId } = request.params
    const { order } = request.body

    const client = await pg.connect()
    try {
      await client.query('BEGIN')

      const existing = await client.query('SELECT id FROM tour_stops WHERE tour_id = $1', [tourId])
      const existingIds = new Set(existing.rows.map((row) => row.id))
      const providedIds = new Set(order)

      if (existingIds.size !== providedIds.size || [...existingIds].some((id) => !providedIds.has(id))) {
        await client.query('ROLLBACK')
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'order must contain exactly the ids of every existing stop for this tour, with no duplicates.'
        })
      }

      for (let i = 0; i < order.length; i++) {
        await client.query(
          'UPDATE tour_stops SET position = $1 WHERE id = $2 AND tour_id = $3',
          [i, order[i], tourId]
        )
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    const { rows } = await pg.query(
      'SELECT * FROM tour_stops WHERE tour_id = $1 ORDER BY position ASC',
      [tourId]
    )
    return rows
  })

  fastify.delete('/:tourId/stops/:stopId', { preHandler: fastify.requirePublishKey }, async (request, reply) => {
    const { tourId, stopId } = request.params
    const { rows } = await pg.query(
      'DELETE FROM tour_stops WHERE id = $1 AND tour_id = $2 RETURNING id',
      [stopId, tourId]
    )
    if (!rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Stop not found.' })
    }
    return { message: 'Stop removed.' }
  })
}