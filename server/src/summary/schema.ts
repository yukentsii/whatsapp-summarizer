import { z } from 'zod';

/** One flagged message, as the model reports it. Chat and sender are filled in from the database. */
const ModelItem = z.object({
  message_id: z.string(),
  reason: z.string(),
});

/** What the model returns for one chat (or one chunk of a large chat). */
export const ChatChunkSummarySchema = z.object({
  brief: z.string(),
  must_not_miss: z.array(ModelItem),
  questions_to_me: z.array(ModelItem),
  mentions_of_me: z.array(ModelItem),
  dates_and_plans: z.array(
    z.object({
      what: z.string(),
      when: z.string(),
      message_id: z.string(),
    }),
  ),
});
export type ChatChunkSummary = z.infer<typeof ChatChunkSummarySchema>;

/** Merges the briefs of a chat that was split into chunks. */
export const MergedBriefSchema = z.object({ brief: z.string() });

/** Combined summary across all chats. */
export const OverallSchema = z.object({ overall: z.string() });

const Item = z.object({
  chat: z.string(),
  sender: z.string(),
  message_id: z.string(),
  reason: z.string(),
});
export type SummaryItem = z.infer<typeof Item>;

/** The structured summary stored in the summaries table and returned to the client. */
export const SummarySchema = z.object({
  range: z.object({ since: z.string(), until: z.string() }),
  must_not_miss: z.array(Item),
  questions_to_me: z.array(Item),
  mentions_of_me: z.array(Item),
  dates_and_plans: z.array(z.object({ what: z.string(), when: z.string(), chat: z.string() })),
  per_chat: z.array(z.object({ chat: z.string(), brief: z.string(), message_count: z.number().int() })),
  overall: z.string(),
});
export type Summary = z.infer<typeof SummarySchema>;

/** JSON Schema for a provider's structured-output parameter. */
export function toProviderSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}
