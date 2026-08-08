import { JiraConfig, DeploymentType, TicketInfo } from '@/shared/types';
import { decryptString, encryptString, EncryptedValue } from './secure-store';

// Shape persisted in chrome.storage.local — the auth header is stored
// encrypted; `token` only appears in legacy configs and is migrated on
// first load.
interface StoredJiraConfig {
  baseUrl: string;
  deploymentType: DeploymentType;
  auth?: EncryptedValue;
  token?: string;
}

export class JiraClient {
  private config: JiraConfig | null = null;

  async loadConfig(): Promise<JiraConfig | null> {
    if (this.config) return this.config;
    const stored = await chrome.storage.local.get(['jiraConfig']);
    const raw = stored.jiraConfig as StoredJiraConfig | undefined;
    if (!raw?.baseUrl) return null;

    if (raw.token) {
      // Legacy plaintext config — re-save encrypted
      this.config = { baseUrl: raw.baseUrl, token: raw.token, deploymentType: raw.deploymentType };
      await this.saveConfig(this.config);
      return this.config;
    }

    if (!raw.auth) return null;
    try {
      const token = await decryptString(raw.auth);
      this.config = { baseUrl: raw.baseUrl, token, deploymentType: raw.deploymentType };
      return this.config;
    } catch {
      // Encryption key is gone (e.g. site data cleared) — the credential
      // is unrecoverable, so drop the config and let the user reconnect.
      await this.clearConfig();
      return null;
    }
  }

  async saveConfig(config: JiraConfig): Promise<void> {
    this.config = config;
    const storedConfig: StoredJiraConfig = {
      baseUrl: config.baseUrl,
      deploymentType: config.deploymentType,
      auth: await encryptString(config.token),
    };
    await chrome.storage.local.set({ jiraConfig: storedConfig });
  }

  async clearConfig(): Promise<void> {
    this.config = null;
    await chrome.storage.local.remove('jiraConfig');
  }

  async connect(baseUrl: string, token: string, email?: string): Promise<{ success: boolean; deploymentType?: DeploymentType; displayName?: string; error?: string }> {
    const normalizedUrl = baseUrl.replace(/\/+$/, '');

    try {
      const origin = new URL(normalizedUrl).origin;
      // Host permission must be requested from the side panel (user gesture);
      // here we only verify it was granted.
      const granted = await chrome.permissions.contains({ origins: [`${origin}/*`] });
      if (!granted) {
        return { success: false, error: 'Host permission for the Jira domain was not granted' };
      }
    } catch {
      return { success: false, error: 'Invalid Jira URL' };
    }

    const authHeader = email
      ? `Basic ${btoa(`${email}:${token}`)}`
      : `Bearer ${token}`;

    try {
      const infoRes = await fetch(`${normalizedUrl}/rest/api/2/serverInfo`, {
        headers: { Authorization: authHeader },
      });
      if (!infoRes.ok) {
        return { success: false, error: `Could not reach Jira (HTTP ${infoRes.status})` };
      }
      const serverInfo = await infoRes.json();
      const deploymentType: DeploymentType = serverInfo.deploymentType === 'Cloud' ? 'Cloud' : 'DataCenter';

      const meRes = await fetch(`${normalizedUrl}/rest/api/2/myself`, {
        headers: { Authorization: authHeader },
      });
      if (!meRes.ok) {
        return { success: false, error: meRes.status === 401 ? 'Invalid credentials' : `Auth check failed (HTTP ${meRes.status})` };
      }
      const myself = await meRes.json();

      await this.saveConfig({ baseUrl: normalizedUrl, token: authHeader, deploymentType });

      return { success: true, deploymentType, displayName: myself.displayName || myself.name };
    } catch (error) {
      return { success: false, error: `Connection failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async testConnection(): Promise<{ success: boolean; displayName?: string; error?: string }> {
    try {
      const myself = await this.apiFetch('/rest/api/2/myself');
      return { success: true, displayName: myself.displayName || myself.name };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async getTicket(key: string): Promise<TicketInfo | null> {
    try {
      const config = await this.requireConfig();
      const issue = await this.apiFetch(`/rest/api/2/issue/${encodeURIComponent(key)}?fields=summary,status,assignee`);
      return {
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status?.name || 'Unknown',
        assignee: issue.fields.assignee?.displayName || null,
        url: `${config.baseUrl}/browse/${issue.key}`,
      };
    } catch {
      return null;
    }
  }

  async attachScreenshot(key: string, imageBlob: Blob, filename: string): Promise<{ success: boolean; error?: string }> {
    try {
      const config = await this.requireConfig();

      const formData = new FormData();
      formData.append('file', imageBlob, filename);

      const response = await fetch(`${config.baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}/attachments`, {
        method: 'POST',
        headers: {
          Authorization: config.token,
          'X-Atlassian-Token': 'no-check',
        },
        body: formData,
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async postComment(key: string, text: string, imageFilename: string, pinLocation: string): Promise<{ success: boolean; error?: string }> {
    try {
      const config = await this.requireConfig();
      // Use the v2 endpoint with a wiki-markup body on Cloud too: Cloud's
      // v2 API converts the string to ADF server-side and resolves
      // !filename! against the issue's attachments, rendering the
      // screenshot inline. (v3 ADF media nodes would need the internal
      // media UUID, which the attachments API doesn't return.)
      const body = this.buildWikiCommentBody(text, imageFilename, pinLocation);

      const response = await fetch(`${config.baseUrl}/rest/api/2/issue/${encodeURIComponent(key)}/comment`, {
        method: 'POST',
        headers: {
          Authorization: config.token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  private buildWikiCommentBody(text: string, imageFilename: string, pinLocation: string): Record<string, unknown> {
    return {
      body: `${text}\n\n!${imageFilename}|width=600!\nPin location: ${pinLocation}`,
    };
  }

  private async apiFetch(endpoint: string): Promise<any> {
    const config = await this.requireConfig();
    const response = await fetch(`${config.baseUrl}${endpoint}`, {
      headers: { Authorization: config.token },
    });
    if (!response.ok) {
      throw new Error(`Jira API error: HTTP ${response.status}`);
    }
    return response.json();
  }

  private async requireConfig(): Promise<JiraConfig> {
    const config = await this.loadConfig();
    if (!config) {
      throw new Error('Jira not configured');
    }
    return config;
  }
}
