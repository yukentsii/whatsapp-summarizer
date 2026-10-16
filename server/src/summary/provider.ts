export interface StructuredRequest {
  system: string;
  user: string;
  /** Short identifier for the schema (OpenAI requires a name). */
  schemaName: string;
  /** JSON Schema the response must follow. */
  jsonSchema: Record<string, unknown>;
}

/** A model backend that returns raw JSON text; validation happens in the pipeline. */
export interface SummaryProvider {
  readonly name: string;
  readonly model: string;
  complete(req: StructuredRequest): Promise<string>;
}

export class ProviderRefusalError extends Error {}
