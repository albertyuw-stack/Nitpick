import { TICKET_ID_REGEX } from './types';

// Builds the scan regex from a Jira space/project key like "MIST" or
// "MIST-". Returns null when no key is set.
export function buildProjectRegex(projectKey: string): RegExp | null {
  const key = (projectKey ?? '').trim().replace(/-+$/, '');
  if (!key) return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}-\\d+`, 'i');
}

// The pattern used to find ticket IDs in URLs, tab titles, and page
// content. Uses the user's configured space key when set; otherwise
// falls back to the generic Jira-key pattern.
export async function loadTicketRegex(): Promise<RegExp> {
  try {
    const { ticketProject } = await chrome.storage.local.get(['ticketProject']);
    const custom = buildProjectRegex(ticketProject ?? '');
    if (custom) return custom;
  } catch {
    // Fall through to the default
  }
  return TICKET_ID_REGEX;
}
