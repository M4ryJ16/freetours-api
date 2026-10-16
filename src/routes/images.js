import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from '#config/env.js'

const EXTENSION_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
}

function uploadsPrefix(base) {
  return `${base}/uploads/`
}

export default async function imageRoutes(fastify) {
  const { pg } = fastify

  // Ensure the upload directory exists before the first request lands.
  await mkdir(config.uploadDir, { recursive: true })


  // Updates an image's description ("alt") and/or its own standalone
  // position field. Distinct from gallery position (see routes/gallery.js),
  // which controls ordering within one specific tour's gallery.
  fastify.patch('/:id', {
    preHandler: fastify.requirePublishKey,
    schema: {
      body: {
        type: 'object',
        minProperties: 1,
        properties: {
          alt: { type: 'string', maxLength: 1000 },
          position: { type: 'integer', minimum: 0 }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const sets = []
    const values = []
    if (request.body.alt !== undefined) {
      values.push(request.body.alt)
      sets.push(`alt = $${values.length}`)
    }
    if (request.body.position !== undefined) {
      values.push(request.body.position)
      sets.push(`position = $${values.length}`)
    }
    values.push(request.params.id)

    const { rows } = await pg.query(
      `UPDATE images SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    )
    if (!rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Image not found.' })
    }
    return rows[0]
  })

  fastify.get('/:id', async (request, reply) => {
    const { rows } = await pg.query('SELECT * FROM images WHERE id = $1', [request.params.id])
    if (!rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Image not found.' })
    }
    return rows[0]
  })

  // Accepts a single image file as multipart/form-data (field name "file"),
  // streams it to disk under config.uploadDir, and stores the served URL
  // on the images row. Optional extra form fields: "alt", "position".
  //
  // IMPORTANT: @fastify/multipart's async iterator (request.parts()) won't
  // yield the next part — or let the loop finish — until the *current*
  // file part's stream has been drained. So the file must be written to
  // disk (or otherwise consumed) as soon as it's encountered, inside the
  // loop. Storing the part and processing it after the loop deadlocks:
  // the loop can't finish until the stream is read, and nothing reads it
  // until the loop finishes.
  //
  // The file is served back out via @fastify/static registered at the
  // '/uploads/' prefix in server.js — see that file for the static config.
  fastify.post('/', { preHandler: fastify.requirePublishKey }, async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Expected multipart/form-data with an image file under field "file".'
      })
    }

    let savedFilename = null
    let savedFilepath = null
    let fileTruncated = false
    let fileSeen = false
    let alt = null
    let position = 0

    for await (const part of request.parts()) {
      if (part.type === 'file' && part.fieldname === 'file') {
        fileSeen = true

        const extension = EXTENSION_BY_MIME[part.mimetype]
        if (!extension) {
          // Drain the stream even on rejection so the parser can move on
          // and the connection doesn't hang.
          await part.file.resume()
          return reply.code(400).send({
            error: 'Bad Request',
            message: `Unsupported file type "${part.mimetype}". Allowed: ${Object.keys(EXTENSION_BY_MIME).join(', ')}.`
          })
        }

        const filename = `${crypto.randomUUID()}${extension}`
        const filepath = path.join(config.uploadDir, filename)

        try {
          await pipeline(part.file, createWriteStream(filepath))
        } catch (err) {
          request.log.error({ err }, 'Failed to write uploaded image to disk')
          return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to save uploaded image.' })
        }

        // @fastify/multipart sets `file.truncated` when the stream exceeded
        // the configured size limit. Checked after pipeline() resolves,
        // since the stream is fully drained either way by then.
        if (part.file.truncated) {
          await unlink(filepath).catch(() => {})
          fileTruncated = true
        } else {
          savedFilename = filename
          savedFilepath = filepath
        }
      } else if (part.type === 'field') {
        if (part.fieldname === 'alt') alt = part.value
        if (part.fieldname === 'position') position = Number(part.value) || 0
      }
    }

    if (!fileSeen) {
      return reply.code(400).send({ error: 'Bad Request', message: 'No file provided under field "file".' })
    }

    if (fileTruncated) {
      return reply.code(413).send({
        error: 'Payload Too Large',
        message: `File exceeds the maximum allowed size of ${config.maxUploadBytes} bytes.`
      })
    }

    const base = config.publicBaseUrl ?? `${request.protocol}://${request.headers.host}`
    const url = `${uploadsPrefix(base)}${savedFilename}`

    try {
      const { rows } = await pg.query(
        'INSERT INTO images (url, alt, position) VALUES ($1, $2, $3) RETURNING *',
        [url, alt, position]
      )
      reply.code(201)
      return rows[0]
    } catch (err) {
      // DB insert failed — don't leave an orphaned file on disk.
      await unlink(savedFilepath).catch(() => {})
      throw err
    }
  })

  fastify.delete('/:id', { preHandler: fastify.requirePublishKey }, async (request, reply) => {
    const { rows } = await pg.query('DELETE FROM images WHERE id = $1 RETURNING id, url', [request.params.id])
    if (!rows.length) {
      return reply.code(404).send({ error: 'Not Found', message: 'Image not found.' })
    }

    // Best-effort cleanup of the file on disk. Only applies to images we
    // actually saved (url matches our /uploads/ prefix) — skip silently
    // for anything else, e.g. legacy rows from before this change.
    const stored = rows[0].url ?? ''
    const marker = '/uploads/'
    const markerIndex = stored.indexOf(marker)
    if (markerIndex !== -1) {
      const filename = stored.slice(markerIndex + marker.length)
      await unlink(path.join(config.uploadDir, filename)).catch(() => {})
    }

    return { message: 'Image deleted.' }
  })
}
