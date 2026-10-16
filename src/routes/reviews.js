const MAX_RANDOM_REVIEWS = 50
const DEFAULT_RANDOM_REVIEWS = 5

const MAX_PAGE_SIZE = 100
const DEFAULT_PAGE_SIZE = 20

const reviewSelect = `
  r.id, r.stars, r.content, r.tour_id, r.customer_id, r.created_at,
  t.name AS tour_name,
  c.full_name AS customer_name
`

export default async function reviewRoutes(fastify) {
  const { pg } = fastify

  // --- Create a review for a tour ------------------------------------------
  // One review per (customer, tour) — enforced by uq_customer_tour.
  fastify.post('/tours/:tourId/reviews', {
    schema: {
      body: {
        type: 'object',
        required: ['customerId', 'stars'],
        properties: {
          customerId: { type: 'string', format: 'uuid' },
          stars: { type: 'integer', minimum: 1, maximum: 5 },
          content: { type: 'string', maxLength: 5000 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { tourId } = request.params
    const { customerId, stars, content } = request.body

    const tour = await pg.query('SELECT id FROM tours WHERE id = $1', [tourId])
    if (!tour.rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
    }

    try {
      const { rows } = await pg.query(
        `INSERT INTO reviews (stars, content, tour_id, customer_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [stars, content ?? null, tourId, customerId]
      )
      reply.code(201)
      return rows[0]
    } catch (err) {
      if (err.code === '23503') {
        return reply.code(404).send({ error: 'Not Found', message: 'Customer not found.' })
      }
      if (err.code === '23505') {
        return reply.code(409).send({ error: 'Conflict', message: 'This customer has already reviewed this tour.' })
      }
      throw err
    }
  })

  // --- List reviews for a tour, paginated -----------------------------------
  fastify.get('/tours/:tourId/reviews', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE },
          offset: { type: 'integer', minimum: 0 },
          stars: { type: 'integer', minimum: 1, maximum: 5 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { tourId } = request.params
    const { limit = DEFAULT_PAGE_SIZE, offset = 0, stars } = request.query

    const tour = await pg.query('SELECT id FROM tours WHERE id = $1', [tourId])
    if (!tour.rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
    }

    const conditions = ['r.tour_id = $1']
    const values = [tourId]
    if (stars !== undefined) {
      values.push(stars)
      conditions.push(`r.stars = $${values.length}`)
    }
    values.push(limit, offset)

    const { rows } = await pg.query(
      `SELECT ${reviewSelect}
       FROM reviews r
       JOIN tours t ON t.id = r.tour_id
       JOIN customers c ON c.id = r.customer_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY r.created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    )
    return rows
  })

  // --- Aggregate rating summary for a tour ----------------------------------
  fastify.get('/tours/:tourId/reviews/summary', async (request, reply) => {
    const { tourId } = request.params

    const tour = await pg.query('SELECT id FROM tours WHERE id = $1', [tourId])
    if (!tour.rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
    }

    const { rows: agg } = await pg.query(
      `SELECT COUNT(*)::int AS review_count,
              COALESCE(ROUND(AVG(stars)::numeric, 2), 0) AS average_stars
       FROM reviews WHERE tour_id = $1`,
      [tourId]
    )
    const { rows: breakdownRows } = await pg.query(
      `SELECT stars, COUNT(*)::int AS count
       FROM reviews WHERE tour_id = $1
       GROUP BY stars`,
      [tourId]
    )
    const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    for (const row of breakdownRows) breakdown[row.stars] = row.count

    return {
      tourId,
      reviewCount: agg[0].review_count,
      averageStars: Number(agg[0].average_stars),
      breakdown
    }
  })

  // --- Special endpoint: a variable, caller-chosen quantity of reviews -----
  // Pulls a random sample of reviews across the whole catalog (optionally
  // scoped to a tour and/or a minimum star rating) — handy for things like
  // a rotating testimonials widget where the caller decides how many
  // reviews to show. `count` is client-controlled but capped server-side
  // so it can't be used to dump the entire table in one request.
  fastify.get('/reviews/random', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          count: { type: 'integer', minimum: 1, maximum: MAX_RANDOM_REVIEWS },
          tourId: { type: 'string', format: 'uuid' },
          minStars: { type: 'integer', minimum: 1, maximum: 5 },
          withContentOnly: { type: 'boolean' }
        },
        additionalProperties: false
      }
    }
  }, async (request) => {
    const { count = DEFAULT_RANDOM_REVIEWS, tourId, minStars, withContentOnly = false } = request.query

    const conditions = []
    const values = []

    if (tourId) {
      values.push(tourId)
      conditions.push(`r.tour_id = $${values.length}`)
    }
    if (minStars !== undefined) {
      values.push(minStars)
      conditions.push(`r.stars >= $${values.length}`)
    }
    if (withContentOnly) {
      conditions.push(`r.content IS NOT NULL AND length(trim(r.content)) > 0`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    values.push(count)

    const { rows } = await pg.query(
      `SELECT ${reviewSelect}
       FROM reviews r
       JOIN tours t ON t.id = r.tour_id
       JOIN customers c ON c.id = r.customer_id
       ${where}
       ORDER BY random()
       LIMIT $${values.length}`,
      values
    )
    return { count: rows.length, requested: count, reviews: rows }
  })

  // --- Single review ---------------------------------------------------------
  fastify.get('/reviews/:id', async (request, reply) => {
    const { rows } = await pg.query(
      `SELECT ${reviewSelect}
       FROM reviews r
       JOIN tours t ON t.id = r.tour_id
       JOIN customers c ON c.id = r.customer_id
       WHERE r.id = $1`,
      [request.params.id]
    )
    if (!rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Review not found.' })
    }
    return rows[0]
  })

  fastify.patch('/reviews/:id', {
    schema: {
      body: {
        type: 'object',
        minProperties: 1,
        properties: {
          stars: { type: 'integer', minimum: 1, maximum: 5 },
          content: { type: 'string', maxLength: 5000 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const sets = []
    const values = []
    if (request.body.stars !== undefined) {
      values.push(request.body.stars)
      sets.push(`stars = $${values.length}`)
    }
    if (request.body.content !== undefined) {
      values.push(request.body.content)
      sets.push(`content = $${values.length}`)
    }
    values.push(request.params.id)

    const { rows } = await pg.query(
      `UPDATE reviews SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    )
    if (!rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Review not found.' })
    }
    return rows[0]
  })

  fastify.delete('/reviews/:id', async (request, reply) => {
    const { rows } = await pg.query('DELETE FROM reviews WHERE id = $1 RETURNING id', [request.params.id])
    if (!rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Review not found.' })
    }
    return { message: 'Review deleted.' }
  })
}
