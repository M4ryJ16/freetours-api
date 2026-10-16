// Registered with prefix '/tours', so final paths are
// /tours/:tourId/gallery ...

export default async function galleryRoutes(fastify) {
  const { pg } = fastify

  fastify.get('/:tourId/gallery', async (request) => {
    const { tourId } = request.params
    const { rows } = await pg.query(
      `SELECT g.id AS gallery_id, g.position, i.id AS image_id, i.url, i.alt
       FROM gallery g
       JOIN images i ON i.id = g.image_id
       WHERE g.tour_id = $1
       ORDER BY g.position ASC`,
      [tourId]
    )
    return rows
  })

  // Reorders an image within this tour's gallery without detaching and
  // reattaching it (which would also mean re-uploading nothing but losing
  // the gallery_id / creating a new row unnecessarily).
  fastify.patch('/:tourId/gallery/:galleryId', {
    preHandler: fastify.requirePublishKey,
    schema: {
      body: {
        type: 'object',
        required: ['position'],
        properties: {
          position: { type: 'integer', minimum: 0 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { tourId, galleryId } = request.params
    const { rows } = await pg.query(
      'UPDATE gallery SET position = $1 WHERE id = $2 AND tour_id = $3 RETURNING *',
      [request.body.position, galleryId, tourId]
    )
    if (!rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Gallery entry not found.' })
    }
    return rows[0]
  })

  // Attaches an already-uploaded image (see POST /images) to a tour's
  // gallery. Upload the image first, then pass its id here — this route
  // no longer accepts a raw external url.
  fastify.post('/:tourId/gallery', {
    preHandler: fastify.requirePublishKey,
    schema: {
      body: {
        type: 'object',
        required: ['imageId'],
        properties: {
          imageId: { type: 'string', format: 'uuid' },
          position: { type: 'integer', minimum: 0 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const { tourId } = request.params
    const { imageId, position = 0 } = request.body

    const tour = await pg.query('SELECT id FROM tours WHERE id = $1', [tourId])
    if (!tour.rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Tour not found.' })
    }

    const image = await pg.query('SELECT id FROM images WHERE id = $1', [imageId])
    if (!image.rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Image not found. Upload it via POST /images first.' })
    }

    try {
      const { rows } = await pg.query(
        'INSERT INTO gallery (tour_id, image_id, position) VALUES ($1, $2, $3) RETURNING *',
        [tourId, imageId, position]
      )
      reply.code(201)
      return rows[0]
    } catch (err) {
      if (err.code === '23505') {
        return reply.code(409).send({ error: 'Conflict', message: 'That image is already in this tour gallery.' })
      }
      throw err
    }
  })

  fastify.delete('/:tourId/gallery/:galleryId', { preHandler: fastify.requirePublishKey }, async (request, reply) => {
    const { tourId, galleryId } = request.params
    const { rows } = await pg.query(
      'DELETE FROM gallery WHERE id = $1 AND tour_id = $2 RETURNING id',
      [galleryId, tourId]
    )
    if (!rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Gallery entry not found.' })
    }
    return { message: 'Image removed from gallery.' }
  })
}
