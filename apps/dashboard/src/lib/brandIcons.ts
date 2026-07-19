// Brand icons from Simple Icons (CC0). Statically imported by name so the bundler tree-shakes to only
// these — we do NOT pull in the full icon set. Platforms without a Simple Icon (removed over trademark,
// e.g. Slack/LinkedIn/OpenAI/Salesforce) fall back to a monogram avatar in ConnectorAvatar.
import {
  siAirtable,
  siAsana,
  siClaude,
  siClickup,
  siConfluence,
  siDatadog,
  siDiscord,
  siFigma,
  siGithub,
  siGitlab,
  siGmail,
  siGooglecalendar,
  siGoogledocs,
  siGooglegemini,
  siGooglemeet,
  siGooglesheets,
  siHubspot,
  siIfttt,
  siIntercom,
  siJira,
  siLinear,
  siMake,
  siMiro,
  siN8n,
  siNotion,
  siOllama,
  siPagerduty,
  siSentry,
  siStripe,
  siTelegram,
  siTodoist,
  siTrello,
  siVercel,
  siWebex,
  siWhatsapp,
  siZapier,
  siZendesk,
  siZoom,
} from 'simple-icons';

export interface BrandIcon {
  /** SVG path data (24x24 viewBox). */
  path: string;
  /** Brand hex color, no leading '#'. */
  hex: string;
}

/** Map a Conduit platform id to its Simple Icon. Missing platforms fall back to a monogram. */
export const BRAND_ICONS: Record<string, BrandIcon> = {
  github: siGithub,
  gitlab: siGitlab,
  discord: siDiscord,
  telegram: siTelegram,
  whatsapp: siWhatsapp,
  notion: siNotion,
  linear: siLinear,
  jira: siJira,
  confluence: siConfluence,
  asana: siAsana,
  trello: siTrello,
  clickup: siClickup,
  todoist: siTodoist,
  airtable: siAirtable,
  miro: siMiro,
  gmail: siGmail,
  google_calendar: siGooglecalendar,
  google_docs: siGoogledocs,
  google_sheets: siGooglesheets,
  google_meet: siGooglemeet,
  zoom: siZoom,
  webex: siWebex,
  figma: siFigma,
  hubspot: siHubspot,
  intercom: siIntercom,
  zendesk: siZendesk,
  stripe: siStripe,
  sentry: siSentry,
  datadog: siDatadog,
  pagerduty: siPagerduty,
  vercel: siVercel,
  zapier: siZapier,
  make: siMake,
  n8n: siN8n,
  ifttt: siIfttt,
  claude: siClaude,
  gemini: siGooglegemini,
  ollama: siOllama,
};

/** Pick a readable foreground (black/white) for a brand-colored background via relative luminance. */
export function readableForeground(hex: string): string {
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#0b0f14' : '#ffffff';
}
