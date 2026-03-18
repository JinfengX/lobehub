export interface TextToSpeechPayload {
  input: string;
  model: string;
  voice: string;
}

export interface TextToSpeechOptions {
  headers?: Record<string, unknown>;
  signal?: AbortSignal;
  /**
   * userId for the embeddings
   */
  user?: string;
}
