import type { ConnectorManifest } from './connectorManifest.js';

/**
 * Bundled connector manifests. Each is a declarative definition executed by ManifestDriver.
 *
 * IMPORTANT: these encode the correct base URL, auth scheme, and a STARTER SET of common operations for
 * each platform. They are not exhaustively validated against every live API — verify operations/paths
 * against the provider's current docs before production use, and extend `operations` as needed.
 *
 * Credential `secret` fields referenced via `{field}` templates (documented per manifest):
 *   - `token`      OAuth/PAT/bot token (most bearer platforms)
 *   - `baseUrl`    overrides the default base URL (self-hosted / per-instance)
 *   - `subdomain` / `site` / `instance` / `company`   per-tenant host segment
 *   - `key`, `apiKey`, `appKey`, `webhookUrl`, `username`, `password`   scheme-specific
 */

const bearer = { Authorization: 'Bearer {token}' } as const;

export const BUNDLED_MANIFESTS: ConnectorManifest[] = [
  // ── Messaging ──────────────────────────────────────────────────────────────
  {
    platform: 'discord',
    label: 'Discord',
    docsUrl: 'https://discord.com/developers/applications',
    baseUrl: 'https://discord.com/api/v10',
    authMethods: ['bearer'],
    headers: { Authorization: 'Bot {token}' },
    operations: {
      send_message: { description: 'Send a message to a channel.', method: 'POST', path: '/channels/{channel_id}/messages' },
      list_guilds: { description: 'List the bot user’s guilds.', method: 'GET', path: '/users/@me/guilds' },
    },
    test: { description: 'Validate the token (bot user).', method: 'GET', path: '/users/@me' },
  },
  {
    platform: 'telegram',
    label: 'Telegram Bot',
    docsUrl: 'https://core.telegram.org/bots#botfather',
    baseUrl: 'https://api.telegram.org/bot{token}',
    authMethods: ['apiKey'],
    operations: {
      send_message: { description: 'Send a message (args: chat_id, text).', method: 'POST', path: '/sendMessage' },
      get_updates: { description: 'Poll for updates.', method: 'GET', path: '/getUpdates' },
    },
    test: { description: 'Validate the token (getMe).', method: 'GET', path: '/getMe' },
  },
  {
    platform: 'whatsapp',
    label: 'WhatsApp Cloud API',
    baseUrl: 'https://graph.facebook.com/v20.0',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      send_message: { description: 'Send a message (args under /{phone_number_id}/messages).', method: 'POST', path: '/{phone_number_id}/messages' },
    },
    test: { description: 'Validate the token (debug /me).', method: 'GET', path: '/me' },
  },
  {
    platform: 'teams',
    label: 'Microsoft Teams (Graph)',
    baseUrl: 'https://graph.microsoft.com/v1.0',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      send_channel_message: { description: 'Post a channel message.', method: 'POST', path: '/teams/{team_id}/channels/{channel_id}/messages' },
      list_teams: { description: 'List joined teams.', method: 'GET', path: '/me/joinedTeams' },
    },
    test: { description: 'Validate the token (current user).', method: 'GET', path: '/me' },
  },

  // ── Dev tools ──────────────────────────────────────────────────────────────
  {
    platform: 'github',
    label: 'GitHub',
    docsUrl: 'https://github.com/settings/tokens',
    baseUrl: 'https://api.github.com',
    authMethods: ['bearer'],
    headers: { ...bearer, 'X-GitHub-Api-Version': '2022-11-28' },
    operations: {
      create_issue: { description: 'Open an issue.', method: 'POST', path: '/repos/{owner}/{repo}/issues' },
      add_comment: { description: 'Comment on an issue/PR.', method: 'POST', path: '/repos/{owner}/{repo}/issues/{issue_number}/comments' },
      create_pull_request: { description: 'Open a pull request.', method: 'POST', path: '/repos/{owner}/{repo}/pulls' },
      list_issues: { description: 'List repository issues (read-only).', method: 'GET', path: '/repos/{owner}/{repo}/issues' },
    },
    test: { description: 'Validate the token (current user).', method: 'GET', path: '/user' },
  },
  {
    platform: 'gitlab',
    label: 'GitLab',
    docsUrl: 'https://gitlab.com/-/user_settings/personal_access_tokens',
    baseUrl: 'https://gitlab.com/api/v4',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      create_issue: { description: 'Create a project issue.', method: 'POST', path: '/projects/{id}/issues' },
      list_projects: { description: 'List projects.', method: 'GET', path: '/projects' },
    },
    test: { description: 'Validate the token (current user).', method: 'GET', path: '/user' },
  },
  {
    platform: 'sentry',
    label: 'Sentry',
    docsUrl: 'https://sentry.io/settings/account/api/auth-tokens/',
    baseUrl: 'https://sentry.io/api/0',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      list_issues: { description: 'List project issues.', method: 'GET', path: '/projects/{organization_slug}/{project_slug}/issues/' },
      get_issue: { description: 'Get an issue.', method: 'GET', path: '/issues/{issue_id}/' },
    },
    test: { description: 'Validate the token (organizations).', method: 'GET', path: '/organizations/' },
  },
  {
    platform: 'vercel',
    label: 'Vercel',
    docsUrl: 'https://vercel.com/account/tokens',
    baseUrl: 'https://api.vercel.com',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      list_deployments: { description: 'List deployments.', method: 'GET', path: '/v6/deployments' },
      list_projects: { description: 'List projects.', method: 'GET', path: '/v9/projects' },
    },
    test: { description: 'Validate the token (current user).', method: 'GET', path: '/v2/user' },
  },

  // ── Project management / productivity ────────────────────────────────────────
  {
    platform: 'notion',
    label: 'Notion',
    docsUrl: 'https://www.notion.so/my-integrations',
    baseUrl: 'https://api.notion.com/v1',
    authMethods: ['bearer'],
    headers: { ...bearer, 'Notion-Version': '2022-06-28' },
    operations: {
      create_page: { description: 'Create a page.', method: 'POST', path: '/pages' },
      query_database: { description: 'Query a database.', method: 'POST', path: '/databases/{database_id}/query' },
      search: { description: 'Search pages/databases.', method: 'POST', path: '/search' },
    },
    test: { description: 'Validate the token (bot user).', method: 'GET', path: '/users/me' },
  },
  {
    platform: 'linear',
    label: 'Linear',
    docsUrl: 'https://linear.app/settings/api',
    baseUrl: 'https://api.linear.app/graphql',
    authMethods: ['apiKey'],
    style: 'graphql',
    headers: { Authorization: '{token}' },
    operations: {
      create_issue: {
        description: 'Create an issue (variables: input).',
        graphql: 'mutation($input: IssueCreateInput!){ issueCreate(input:$input){ success issue{ id identifier url } } }',
      },
      list_issues: {
        description: 'List issues.',
        graphql: 'query{ issues(first: 25){ nodes{ id identifier title state{ name } } } }',
      },
    },
    test: { description: 'Validate the key (viewer).', graphql: 'query{ viewer { id } }' },
  },
  {
    platform: 'jira',
    label: 'Jira',
    docsUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    baseUrl: 'https://{site}.atlassian.net/rest/api/3',
    authMethods: ['basic'],
    headers: { Authorization: 'Basic {basic}' },
    operations: {
      create_issue: { description: 'Create an issue.', method: 'POST', path: '/issue' },
      search: { description: 'Search issues (JQL).', method: 'GET', path: '/search' },
    },
    test: { description: 'Validate the token (myself).', method: 'GET', path: '/myself' },
  },
  {
    platform: 'confluence',
    label: 'Confluence',
    docsUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
    baseUrl: 'https://{site}.atlassian.net/wiki/rest/api',
    authMethods: ['basic'],
    headers: { Authorization: 'Basic {basic}' },
    operations: {
      create_page: { description: 'Create content.', method: 'POST', path: '/content' },
      get_page: { description: 'Get content by id.', method: 'GET', path: '/content/{id}' },
    },
    test: { description: 'Validate the token (current user).', method: 'GET', path: '/user/current' },
  },
  {
    platform: 'asana',
    label: 'Asana',
    docsUrl: 'https://app.asana.com/0/my-apps',
    baseUrl: 'https://app.asana.com/api/1.0',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      create_task: { description: 'Create a task.', method: 'POST', path: '/tasks' },
      list_tasks: { description: 'List tasks.', method: 'GET', path: '/tasks' },
    },
    test: { description: 'Validate the token (current user).', method: 'GET', path: '/users/me' },
  },
  {
    platform: 'monday',
    label: 'monday.com',
    docsUrl: 'https://developer.monday.com/api-reference/docs/authentication',
    baseUrl: 'https://api.monday.com/v2',
    authMethods: ['apiKey'],
    style: 'graphql',
    headers: { Authorization: '{token}' },
    operations: {
      create_item: {
        description: 'Create a board item (variables: boardId, itemName).',
        graphql: 'mutation($boardId: ID!, $itemName: String!){ create_item(board_id:$boardId, item_name:$itemName){ id } }',
      },
      list_boards: { description: 'List boards.', graphql: 'query{ boards(limit: 25){ id name } }' },
    },
    test: { description: 'Validate the key (me).', graphql: 'query{ me { id } }' },
  },
  {
    platform: 'trello',
    label: 'Trello',
    docsUrl: 'https://trello.com/app-key',
    baseUrl: 'https://api.trello.com/1',
    authMethods: ['apiKey'],
    query: { key: '{key}', token: '{token}' },
    operations: {
      create_card: { description: 'Create a card (args: idList, name).', method: 'POST', path: '/cards' },
      list_boards: { description: 'List the member’s boards.', method: 'GET', path: '/members/me/boards' },
    },
    test: { description: 'Validate the key (member).', method: 'GET', path: '/members/me' },
  },
  {
    platform: 'clickup',
    label: 'ClickUp',
    docsUrl: 'https://app.clickup.com/settings/apps',
    baseUrl: 'https://api.clickup.com/api/v2',
    authMethods: ['apiKey'],
    headers: { Authorization: '{token}' },
    operations: {
      create_task: { description: 'Create a task in a list.', method: 'POST', path: '/list/{list_id}/task' },
      get_tasks: { description: 'Get tasks in a list.', method: 'GET', path: '/list/{list_id}/task' },
    },
    test: { description: 'Validate the token (current user).', method: 'GET', path: '/user' },
  },
  {
    platform: 'todoist',
    label: 'Todoist',
    docsUrl: 'https://todoist.com/app/settings/integrations/developer',
    baseUrl: 'https://api.todoist.com/rest/v2',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      create_task: { description: 'Create a task.', method: 'POST', path: '/tasks' },
      list_tasks: { description: 'List active tasks.', method: 'GET', path: '/tasks' },
    },
    test: { description: 'Validate the token (projects).', method: 'GET', path: '/projects' },
  },
  {
    platform: 'airtable',
    label: 'Airtable',
    docsUrl: 'https://airtable.com/create/tokens',
    baseUrl: 'https://api.airtable.com/v0',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      list_records: { description: 'List records in a table.', method: 'GET', path: '/{baseId}/{table}' },
      create_record: { description: 'Create records in a table.', method: 'POST', path: '/{baseId}/{table}' },
    },
    test: { description: 'Validate the token (whoami).', method: 'GET', path: '/meta/whoami' },
  },
  {
    platform: 'miro',
    label: 'Miro',
    baseUrl: 'https://api.miro.com/v2',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      create_board: { description: 'Create a board.', method: 'POST', path: '/boards' },
      list_boards: { description: 'List boards.', method: 'GET', path: '/boards' },
    },
    test: { description: 'Validate the token (boards).', method: 'GET', path: '/boards' },
  },

  // ── CRM / support ────────────────────────────────────────────────────────────
  {
    platform: 'hubspot',
    label: 'HubSpot',
    docsUrl: 'https://app.hubspot.com/private-apps',
    baseUrl: 'https://api.hubapi.com',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      create_contact: { description: 'Create a contact.', method: 'POST', path: '/crm/v3/objects/contacts' },
      list_contacts: { description: 'List contacts.', method: 'GET', path: '/crm/v3/objects/contacts' },
    },
    test: { description: 'Validate the token (account info).', method: 'GET', path: '/account-info/v3/details' },
  },
  {
    platform: 'salesforce',
    label: 'Salesforce',
    baseUrl: 'https://{instance}.my.salesforce.com/services/data/v60.0',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      query: { description: 'SOQL query (args: q).', method: 'GET', path: '/query' },
      create_record: { description: 'Create an sObject record.', method: 'POST', path: '/sobjects/{sobject}' },
    },
    test: { description: 'Validate the token (limits).', method: 'GET', path: '/limits' },
  },
  {
    platform: 'pipedrive',
    label: 'Pipedrive',
    baseUrl: 'https://{company}.pipedrive.com/api/v1',
    authMethods: ['apiKey'],
    query: { api_token: '{token}' },
    operations: {
      create_deal: { description: 'Create a deal.', method: 'POST', path: '/deals' },
      list_deals: { description: 'List deals.', method: 'GET', path: '/deals' },
    },
    test: { description: 'Validate the token (current user).', method: 'GET', path: '/users/me' },
  },
  {
    platform: 'intercom',
    label: 'Intercom',
    baseUrl: 'https://api.intercom.io',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      create_contact: { description: 'Create a contact.', method: 'POST', path: '/contacts' },
      list_conversations: { description: 'List conversations.', method: 'GET', path: '/conversations' },
    },
    test: { description: 'Validate the token (me).', method: 'GET', path: '/me' },
  },
  {
    platform: 'zendesk',
    label: 'Zendesk',
    docsUrl: 'https://support.zendesk.com/hc/en-us/articles/4408889192858',
    baseUrl: 'https://{subdomain}.zendesk.com/api/v2',
    authMethods: ['basic'],
    headers: { Authorization: 'Basic {basic}' },
    operations: {
      create_ticket: { description: 'Create a ticket.', method: 'POST', path: '/tickets' },
      list_tickets: { description: 'List tickets.', method: 'GET', path: '/tickets' },
    },
    test: { description: 'Validate the token (current user).', method: 'GET', path: '/users/me.json' },
  },
  {
    platform: 'stripe',
    label: 'Stripe (read)',
    docsUrl: 'https://dashboard.stripe.com/apikeys',
    baseUrl: 'https://api.stripe.com/v1',
    authMethods: ['bearer'],
    headers: { ...bearer },
    // NOTE: Stripe writes require x-www-form-urlencoded bodies; the generic JSON driver supports READS.
    // Use a bespoke/REST-form connector for create/update operations.
    operations: {
      list_charges: { description: 'List charges.', method: 'GET', path: '/charges' },
      list_customers: { description: 'List customers.', method: 'GET', path: '/customers' },
    },
    test: { description: 'Validate the key (balance).', method: 'GET', path: '/balance' },
  },

  // ── Google Workspace (OAuth bearer token in secret.token) ────────────────────
  {
    platform: 'gmail',
    label: 'Gmail',
    baseUrl: 'https://gmail.googleapis.com/gmail/v1',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      list_messages: { description: 'List messages.', method: 'GET', path: '/users/me/messages' },
      send_message: { description: 'Send a message (raw RFC822 base64url).', method: 'POST', path: '/users/me/messages/send' },
    },
    test: { description: 'Validate the token (profile).', method: 'GET', path: '/users/me/profile' },
  },
  {
    platform: 'google_calendar',
    label: 'Google Calendar',
    baseUrl: 'https://www.googleapis.com/calendar/v3',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      list_events: { description: 'List events.', method: 'GET', path: '/calendars/{calendarId}/events' },
      create_event: { description: 'Create an event.', method: 'POST', path: '/calendars/{calendarId}/events' },
    },
    test: { description: 'Validate the token (calendar list).', method: 'GET', path: '/users/me/calendarList' },
  },
  {
    platform: 'google_docs',
    label: 'Google Docs',
    baseUrl: 'https://docs.googleapis.com/v1',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      get_document: { description: 'Get a document.', method: 'GET', path: '/documents/{documentId}' },
      create_document: { description: 'Create a document.', method: 'POST', path: '/documents' },
    },
  },
  {
    platform: 'google_sheets',
    label: 'Google Sheets',
    baseUrl: 'https://sheets.googleapis.com/v4',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      get_values: { description: 'Read a range.', method: 'GET', path: '/spreadsheets/{spreadsheetId}/values/{range}' },
      append_values: { description: 'Append rows to a range.', method: 'POST', path: '/spreadsheets/{spreadsheetId}/values/{range}:append' },
    },
  },
  {
    platform: 'google_meet',
    label: 'Google Meet',
    baseUrl: 'https://meet.googleapis.com/v2',
    authMethods: ['bearer'],
    headers: { ...bearer },
    // Meet has no "create meeting" REST call — meetings are created via Calendar conferenceData. This
    // exposes the read-only Meet API (conference records / recordings).
    operations: {
      list_conference_records: { description: 'List conference records.', method: 'GET', path: '/conferenceRecords' },
    },
    test: { description: 'Validate the token (conference records).', method: 'GET', path: '/conferenceRecords' },
  },

  // ── Meetings ─────────────────────────────────────────────────────────────────
  {
    platform: 'zoom',
    label: 'Zoom',
    docsUrl: 'https://marketplace.zoom.us/',
    baseUrl: 'https://api.zoom.us/v2',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      create_meeting: { description: 'Create a meeting for a user.', method: 'POST', path: '/users/{userId}/meetings' },
      list_meetings: { description: 'List a user’s meetings.', method: 'GET', path: '/users/{userId}/meetings' },
    },
    test: { description: 'Validate the token (current user).', method: 'GET', path: '/users/me' },
  },
  {
    platform: 'webex',
    label: 'Webex',
    baseUrl: 'https://webexapis.com/v1',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      create_meeting: { description: 'Create a meeting.', method: 'POST', path: '/meetings' },
      list_meetings: { description: 'List meetings.', method: 'GET', path: '/meetings' },
    },
    test: { description: 'Validate the token (current user).', method: 'GET', path: '/people/me' },
  },

  // ── Design ───────────────────────────────────────────────────────────────────
  {
    platform: 'figma',
    label: 'Figma',
    docsUrl: 'https://www.figma.com/developers/api#access-tokens',
    baseUrl: 'https://api.figma.com/v1',
    authMethods: ['apiKey'],
    headers: { 'X-Figma-Token': '{token}' },
    operations: {
      get_file: { description: 'Get a file.', method: 'GET', path: '/files/{file_key}' },
      get_comments: { description: 'Get file comments.', method: 'GET', path: '/files/{file_key}/comments' },
    },
    test: { description: 'Validate the token (current user).', method: 'GET', path: '/me' },
  },

  // ── Observability / incident ─────────────────────────────────────────────────
  {
    platform: 'datadog',
    label: 'Datadog',
    docsUrl: 'https://app.datadoghq.com/organization-settings/api-keys',
    baseUrl: 'https://api.datadoghq.com/api/v1',
    authMethods: ['apiKey'],
    headers: { 'DD-API-KEY': '{apiKey}', 'DD-APPLICATION-KEY': '{appKey}' },
    operations: {
      post_event: { description: 'Post an event.', method: 'POST', path: '/events' },
      query_metrics: { description: 'Query timeseries (args: from, to, query).', method: 'GET', path: '/query' },
    },
    test: { description: 'Validate the API key.', method: 'GET', path: '/validate' },
  },
  {
    platform: 'pagerduty',
    label: 'PagerDuty',
    docsUrl: 'https://support.pagerduty.com/docs/api-access-keys',
    baseUrl: 'https://api.pagerduty.com',
    authMethods: ['apiKey'],
    headers: { Authorization: 'Token token={token}' },
    operations: {
      list_incidents: { description: 'List incidents.', method: 'GET', path: '/incidents' },
      create_incident: { description: 'Create an incident.', method: 'POST', path: '/incidents' },
    },
    test: { description: 'Validate the token (abilities).', method: 'GET', path: '/abilities' },
  },

  // ── Automation hubs (inbound webhook — secret.webhookUrl is the full hook URL) ─
  {
    platform: 'zapier',
    label: 'Zapier (webhook)',
    baseUrl: '{webhookUrl}',
    authMethods: ['apiKey'],
    operations: { trigger: { description: 'POST a payload to a Zapier catch hook.', method: 'POST', path: '' } },
  },
  {
    platform: 'make',
    label: 'Make (webhook)',
    baseUrl: '{webhookUrl}',
    authMethods: ['apiKey'],
    operations: { trigger: { description: 'POST a payload to a Make webhook.', method: 'POST', path: '' } },
  },
  {
    platform: 'n8n',
    label: 'n8n (webhook)',
    baseUrl: '{webhookUrl}',
    authMethods: ['apiKey'],
    operations: { trigger: { description: 'POST a payload to an n8n webhook.', method: 'POST', path: '' } },
  },
  {
    platform: 'ifttt',
    label: 'IFTTT (Maker webhook)',
    baseUrl: 'https://maker.ifttt.com/trigger/{event}/with/key/{key}',
    authMethods: ['apiKey'],
    operations: { trigger: { description: 'Fire a Maker event (value1..3 in body).', method: 'POST', path: '' } },
  },

  // ── LLM providers ────────────────────────────────────────────────────────────
  {
    platform: 'openai',
    label: 'OpenAI',
    docsUrl: 'https://platform.openai.com/api-keys',
    baseUrl: 'https://api.openai.com/v1',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      chat: { description: 'Chat completion.', method: 'POST', path: '/chat/completions' },
      embeddings: { description: 'Create embeddings.', method: 'POST', path: '/embeddings' },
      list_models: { description: 'List models.', method: 'GET', path: '/models' },
    },
    test: { description: 'Validate the key (models).', method: 'GET', path: '/models' },
  },
  {
    platform: 'claude',
    label: 'Anthropic Claude',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    baseUrl: 'https://api.anthropic.com/v1',
    authMethods: ['apiKey'],
    headers: { 'x-api-key': '{token}', 'anthropic-version': '2023-06-01' },
    operations: {
      messages: { description: 'Create a message (args: model, max_tokens, messages).', method: 'POST', path: '/messages' },
    },
    test: { description: 'Validate the key (models).', method: 'GET', path: '/models' },
  },
  {
    platform: 'gemini',
    label: 'Google Gemini',
    docsUrl: 'https://aistudio.google.com/apikey',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    authMethods: ['apiKey'],
    query: { key: '{token}' },
    operations: {
      generate: { description: 'Generate content (args under /models/{model}:generateContent).', method: 'POST', path: '/models/{model}:generateContent' },
      list_models: { description: 'List models.', method: 'GET', path: '/models' },
    },
    test: { description: 'Validate the key (models).', method: 'GET', path: '/models' },
  },
  {
    platform: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434',
    authMethods: ['apiKey'],
    operations: {
      generate: { description: 'Generate a completion.', method: 'POST', path: '/api/generate' },
      list_models: { description: 'List local models.', method: 'GET', path: '/api/tags' },
    },
    test: { description: 'Validate reachability (tags).', method: 'GET', path: '/api/tags' },
  },

  // ── Social ───────────────────────────────────────────────────────────────────
  {
    platform: 'linkedin',
    label: 'LinkedIn',
    baseUrl: 'https://api.linkedin.com/v2',
    authMethods: ['bearer'],
    headers: { ...bearer },
    operations: {
      get_profile: { description: 'Get the authenticated member profile.', method: 'GET', path: '/me' },
      create_post: { description: 'Create a UGC post.', method: 'POST', path: '/ugcPosts' },
    },
    test: { description: 'Validate the token (profile).', method: 'GET', path: '/me' },
  },
];

/**
 * Platforms with no hosted/automatable API — registered names for discoverability, but not executable via
 * the generic connector. They need a bespoke integration or are out of scope:
 *   - apple_intelligence : on-device only; no server API.
 *   - obsidian           : local vault; only a local REST plugin, not a hosted API.
 *   - loom               : no stable public write API at time of writing.
 */
export const UNSUPPORTED_PLATFORMS = ['apple_intelligence', 'obsidian', 'loom'] as const;
