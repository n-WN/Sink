import { CreatePasteSchema, DEFAULT_PASTE_TTL, pasteId, PasteSchema } from '#shared/schemas/paste'

defineRouteMeta({
  openAPI: {
    description: 'Create a temporary text clipboard entry (paste). Auto-expires after its TTL.',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['content'],
            properties: {
              content: { type: 'string', description: 'The text content to store' },
              lang: { type: 'string', description: 'Syntax-highlight language id (e.g. ts, python, json)' },
              title: { type: 'string', description: 'Optional title' },
              ttl: { type: 'integer', description: 'Time-to-live in seconds (60 .. 2592000). Default 86400.' },
            },
          },
        },
      },
    },
  },
})

export default eventHandler(async (event) => {
  const input = await readValidatedBody(event, CreatePasteSchema.parse)

  if (await pasteCapReached(event))
    throw createError({ status: 429, statusText: 'Too many active snippets' })

  const createdAt = Math.floor(Date.now() / 1000)
  const expiration = createdAt + (input.ttl ?? DEFAULT_PASTE_TTL)

  const paste = PasteSchema.parse({
    id: pasteId(),
    content: input.content,
    lang: input.lang || 'text',
    title: input.title,
    createdAt,
    expiration,
    burn: input.burn ?? false,
    password: input.password ? await hashLinkPassword(input.password) : undefined,
  })

  await putPaste(event, paste)

  setResponseStatus(event, 201)
  return {
    paste: {
      id: paste.id,
      lang: paste.lang,
      title: paste.title,
      createdAt: paste.createdAt,
      expiration: paste.expiration,
      size: paste.content.length,
      burn: paste.burn || undefined,
      hasPassword: paste.password ? true : undefined,
    },
  }
})
