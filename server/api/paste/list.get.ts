import { z } from 'zod'

defineRouteMeta({
  openAPI: {
    description: 'List clipboard entries (metadata only, newest first)',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'limit',
        in: 'query',
        required: false,
        schema: { type: 'integer', default: 50, maximum: 100 },
        description: 'Maximum number of entries to return',
      },
      {
        name: 'cursor',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Pagination cursor from a previous response',
      },
    ],
  },
})

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().max(1024).optional(),
})

export default eventHandler(async (event) => {
  const { limit, cursor } = await getValidatedQuery(event, ListQuerySchema.parse)
  return await listPastes(event, { limit, cursor })
})
