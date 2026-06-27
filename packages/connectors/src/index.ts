/**
 * @conduit/connectors — pluggable platform drivers behind one PlatformDriver interface.
 * Bundled: Slack, Discord, GitHub, GitLab, Jira, Google Workspace, Notion, REST, GraphQL.
 * Slack + GitHub are the reference pattern. Discord/GitLab/Jira/Google/Notion/GraphQL: TODO drivers.
 */
export * from './platformDriver.js';
export * from './connectorRegistry.js';
export { SlackDriver } from './drivers/slack/slackDriver.js';
export { GitHubDriver } from './drivers/github/githubDriver.js';
export { RestDriver } from './drivers/rest/restDriver.js';
export { MockDriver } from './drivers/mock/mockDriver.js';
