// The meeting point is a specific OpenStreetMap location, not just a
// name: an address label plus coordinates (and optionally an OSM
// node/way/relation id). `lat`/`lng` are required — they're what the
// booking-email map is rendered from (see plugins/mailer.js). An
// address can be turned into lat/lng for free via OSM's Nominatim
// geocoder (https://nominatim.openstreetmap.org) on the admin/frontend
// side before calling this API.
//
// Beyond this single required meeting point, a tour can also have any
// number of ordered route stops — see routes/tourStops.js.
const meetingPointSchema = {
  type: 'object',
  required: ['lat', 'lng'],
  properties: {
    address: { type: 'string', minLength: 1, maxLength: 500 },
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
    osmId: { type: 'string', maxLength: 255 }
  },
  additionalProperties: false
}

// durationHours accepts fractional values (e.g. 2.5 for a two-and-a-half
// hour tour), not just whole hours — matches tours.duration_hours being
// DOUBLE PRECISION rather than an integer column.
const durationHoursSchema = { type: 'number', exclusiveMinimum: 0 }

const tourCreateSchema = {
  body: {
    type: 'object',
    required: ['name', 'description', 'meetingPoint'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', minLength: 1 },
      image: { type: 'string', format: 'uuid' },
      meetingPoint: meetingPointSchema,
      durationHours: durationHoursSchema,
      capacity: { type: 'integer', minimum: 1 },
      isActive: { type: 'boolean' }
    },
    additionalProperties: false
  }
}

const tourUpdateSchema = {
  body: {
    type: 'object',
    minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', minLength: 1 },
      image: { type: ['string', 'null'], format: 'uuid' },
      meetingPoint: meetingPointSchema,
      durationHours: durationHoursSchema,
      capacity: { type: 'integer', minimum: 1 },
      isActive: { type: 'boolean' }
    },
    additionalProperties: false
  }
}

export default async function tourRoutes(fastify) {
  const { pg } = fastify

  // Public catalog browsing — API key only.
  fastify.get('/', async (request) => {
    const { active, limit = 50, offset = 0 } = request.query
    const conditions = []
    const values = []

    if (active !== undefined) {
      values.push(active === 'true' || active === true)
      conditions.push(`is_active = $${values.length}`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    values.push(Number(limit), Number(offset))

    const { rows } = await pg.query(
      `SELECT * FROM tours ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    )
    return rows
  })

  // Includes both the gallery (photos) and the tour's ordered route stops
  // (tour_stops), distinct from the tour's single required meeting point
  // which stays as flat meeting_point* columns on the tour row itself.
  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params
    const { rows } = await pg.query(
      `SELECT t.*,
              COALESCE(json_agg(DISTINCT jsonb_build_object(
                'id', i.id, 'url', i.url, 'alt', i.alt, 'position', g.position
              )) FILTER (WHERE i.id IS NOT NULL), '[]') AS gallery,
              COALESCE((
                SELECT json_agg(jsonb_build_object(
                  'id', s.id, 'name', s.name, 'description', s.description,
                  'lat', s.lat, 'lng', s.lng, 'osmId', s.osm_id, 'position', s.position
                ) ORDER BY s.position ASC)
                FROM tour_stops s
                WHERE s.tour_id = t.id
              ), '[]') AS stops
      FROM tours t
      LEFT JOIN gallery g ON g.tour_id = t.id
      LEFT JOIN images i ON i.id = g.image_id
      WHERE t.id = $1
      GROUP BY t.id`,
      [id]
    )
    if (!rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
    }
    return rows[0]
  })

  // --- Publish-protected: creating/editing/removing catalog content ---

  fastify.post('/', { schema: tourCreateSchema, preHandler: fastify.requirePublishKey }, async (request, reply) => {
    const { name, description, image, meetingPoint, durationHours, capacity, isActive = true } = request.body
    try {
      const { rows } = await pg.query(
        `INSERT INTO tours (name, description, image, meeting_point, meeting_point_lat, meeting_point_lng, meeting_point_osm_id, duration_hours, capacity, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          name, description, image ?? null,
          meetingPoint.address ?? null, meetingPoint.lat, meetingPoint.lng, meetingPoint.osmId ?? null,
          durationHours ?? null, capacity ?? null, isActive
        ]
      )
      reply.code(201)
      return rows[0]
    } catch (err) {
      if (err.code === '23505') {
        return reply.code(409).send({ error: 'Conflict', message: 'A tour with that name already exists.' })
      }
      throw err
    }
  })

  fastify.patch('/:id', { schema: tourUpdateSchema, preHandler: fastify.requirePublishKey }, async (request, reply) => {
    const { id } = request.params

    const sets = []
    const values = []

    // meetingPoint is a nested object mapping to several columns, so it's
    // handled separately from the flat fieldMap loop below.
    if (request.body.meetingPoint !== undefined) {
      const mp = request.body.meetingPoint
      values.push(mp.address ?? null); sets.push(`meeting_point = $${values.length}`)
      values.push(mp.lat); sets.push(`meeting_point_lat = $${values.length}`)
      values.push(mp.lng); sets.push(`meeting_point_lng = $${values.length}`)
      values.push(mp.osmId ?? null); sets.push(`meeting_point_osm_id = $${values.length}`)
    }

    const fieldMap = {
      name: 'name',
      description: 'description',
      image: 'image',
      durationHours: 'duration_hours',
      capacity: 'capacity',
      isActive: 'is_active'
    }
    for (const [key, column] of Object.entries(fieldMap)) {
      if (request.body[key] !== undefined) {
        values.push(request.body[key])
        sets.push(`${column} = $${values.length}`)
      }
    }
    if (!sets.length) {
      return reply.code(400).send({ error: 'Bad Request', message: 'No updatable fields provided.' })
    }

    values.push(id)
    try {
      const { rows } = await pg.query(
        `UPDATE tours SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
        values
      )
      if (!rows.length) {
        return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
      }
      return rows[0]
    } catch (err) {
      if (err.code === '23505') {
        return reply.code(409).send({ error: 'Conflict', message: 'A tour with that name already exists.' })
      }
      throw err
    }
  })

  // Archives (deactivates) rather than hard-deleting, since bookings
  // reference tours and a hard delete would break booking history.
  fastify.delete('/:id', { preHandler: fastify.requirePublishKey }, async (request, reply) => {
    const { id } = request.params
    const { rows } = await pg.query(
      'UPDATE tours SET is_active = false WHERE id = $1 RETURNING id, is_active',
      [id]
    )
    if (!rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
    }
    return { message: 'Tour archived (deactivated).', tour: rows[0] }
  })
}