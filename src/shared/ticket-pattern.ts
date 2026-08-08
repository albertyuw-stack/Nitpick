import { TICKET_ID_REGEX } from './types';

export const DEFAULT_TICKET_PATTERN = TICKET_ID_REGEX.source;

// The user-configurable pattern used to find ticket IDs in URLs, tab
// titles, and page content. Falls back to the default on missing or
// invalid stored patterns.
export async function loadTicketRegex(): Promise<RegExp> {
  try {
    const { ticketPattern } = await chrome.storage.local.get(['ticketPattern']);
    if (ticketPattern) return new RegExp(ticketPattern);
  } catch {
    // Invalid stored pattern — use the default
  }
  return TICKET_ID_REGEX;
}
