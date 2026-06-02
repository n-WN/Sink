import { PASTE_ID_RE } from '#shared/schemas/paste'

defineRouteMeta({
  openAPI: {
    description: 'Delete a clipboard entry',
    security: [{ bearerAuth: [] }],
  },
})

export default eventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !PASTE_ID_RE.test(id))
    throw createError({ status: 400, statusText: 'Invalid id' })

  await deletePaste(event, id)
  setResponseStatus(event, 204)
  return null
})
