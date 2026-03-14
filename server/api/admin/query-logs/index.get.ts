import { useLogger } from 'evlog'
import { z } from 'zod'

import { requireRuntimeAdminSession } from '#server/utils/admin-session'
import { createQueryLogAdminStore } from '#server/utils/query-log-admin-store'
import { KNOWLEDGE_CHANNEL_VALUES } from '#shared/schemas/knowledge-runtime'
import { paginateList, paginationQuerySchema } from '#shared/schemas/pagination'

const QUERY_LOG_STATUS_VALUES = ['accepted', 'blocked', 'limited', 'rejected'] as const

const querySchema = paginationQuerySchema.extend({
  channel: z.enum(KNOWLEDGE_CHANNEL_VALUES).optional(),
  endDate: z.string().datetime().optional(),
  environment: z.string().min(1).optional(),
  redactionApplied: z.coerce.boolean().optional(),
  startDate: z.string().datetime().optional(),
  status: z.enum(QUERY_LOG_STATUS_VALUES).optional(),
})

export default defineEventHandler(async function listQueryLogsHandler(event) {
  const log = useLogger(event)

  const session = await requireRuntimeAdminSession(event)

  const query = await getValidatedQuery(event, querySchema.parse)

  log.set({
    operation: 'admin-query-logs-list',
    table: 'query_logs',
    user: { id: session.user.id ?? null },
  })

  const store = createQueryLogAdminStore()

  const filter = {
    channel: query.channel,
    endDate: query.endDate,
    environment: query.environment,
    redactionApplied: query.redactionApplied,
    startDate: query.startDate,
    status: query.status,
  }

  return paginateList(
    { page: query.page, pageSize: query.pageSize },
    {
      count: () => store.countQueryLogs(filter),
      list: ({ limit, offset }) => store.listQueryLogs({ ...filter, limit, offset }),
    },
  )
})
