import { parse } from 'partial-json';

export const safeParseJSON = <T = Record<string, unknown>>(text?: string) => {
  if (typeof text !== 'string') return undefined;

  let json: T;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }

  return json;
};

export const safeParsePartialJSON = <T = Record<string, unknown>>(text?: string): T | undefined => {
  try {
    return parse(text || '{}') as T;
  } catch {
    return undefined;
  }
};
