export const TICKET_ID_REGEX = /[A-Z][A-Z0-9]{1,9}-\d+/;

export type DeploymentType = 'Cloud' | 'Server' | 'DataCenter';

export interface JiraConfig {
  baseUrl: string;
  token: string;
  deploymentType: DeploymentType;
}

export interface TicketInfo {
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  url: string;
}

export interface PinCoordinates {
  x: number;
  y: number;
  dpr: number;
  pageUrl: string;
}

export type Message =
  | { type: 'connect'; baseUrl: string; token: string; email?: string }
  | { type: 'testConnection' }
  | { type: 'validateTicket'; key: string }
  | { type: 'startPinMode'; tabId: number }
  | { type: 'submit'; key: string; comment: string; imageDataUrl: string; pin: PinCoordinates }
  | { type: 'cancelPin' }
  | { type: 'connectionResult'; success: boolean; error?: string; deploymentType?: DeploymentType }
  | { type: 'ticketInfo'; ticket?: TicketInfo; error?: string }
  | { type: 'urlTicketDetected'; key: string }
  | { type: 'screenshotReady'; dataUrl: string; pin: PinCoordinates }
  | { type: 'submitResult'; success: boolean; error?: string }
  | { type: 'injectOverlay' }
  | { type: 'pinPlaced'; x: number; y: number; dpr: number; pageUrl: string }
  | { type: 'removePin' }
  | { type: 'pinError'; message: string };
