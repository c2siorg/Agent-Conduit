/**
 * Demo agent — minimal end-to-end example of using `conduit-client`.
 * Referenced by the docker-compose `demo` profile. @remarks Scaffold.
 */
import { ConduitClient } from '../conduitClient.js';

async function main(): Promise<void> {
  // 1 const client = new ConduitClient({ baseUrl, hostPrivateKeyJwk });
  // 2 const agent = await client.connectAgent(['post_slack_message']);
  // 3 await client.executeCapability(agent.agentId, 'post_slack_message', { channel: '#general', text: 'hi ' });
  throw new Error('demo agent not implemented');
}

void main();
