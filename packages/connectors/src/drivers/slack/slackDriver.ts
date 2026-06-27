import { ConduitError, ErrorCode } from '@conduit/core';
import type {
  CredentialAuthMethod,
  ExecutionContext,
  ExecutionResult,
  OperationDescriptor,
  PlatformCredential,
  PlatformDriver,
} from '../../platformDriver.js';

interface SlackMethod {
  httpMethod: 'GET' | 'POST';
  apiMethod: string;
}

/** Map of Conduit operation name -> Slack Web API method. Extend here to expose more Slack operations. */
const SLACK_METHODS: Record<string, SlackMethod> = {
  post_message: { httpMethod: 'POST', apiMethod: 'chat.postMessage' },
  list_channels: { httpMethod: 'GET', apiMethod: 'conversations.list' },
  add_reaction: { httpMethod: 'POST', apiMethod: 'reactions.add' },
};

const SLACK_API_BASE = 'https://slack.com/api';

/**
 * SlackDriver — REFERENCE connector. The pattern for any dedicated platform driver: declare the
 * operations, map each to the platform's wire call, inject the bot token server-side, and translate the
 * platform's own success signal (`{ ok: boolean }`) into a canonical ExecutionResult. The token is never
 * returned to the agent.
 */
export class SlackDriver implements PlatformDriver {
  readonly platform = 'slack';

  readonly supportedOperations: OperationDescriptor[] = [
    { name: 'post_message', description: 'Post a message to a channel (args: channel, text).' },
    { name: 'list_channels', description: 'List channels visible to the credential.' },
    { name: 'add_reaction', description: 'Add an emoji reaction (args: channel, timestamp, name).' },
  ];

  readonly supportedAuthMethods: CredentialAuthMethod[] = ['bearer'];

  validateCredential(credential: PlatformCredential): Promise<boolean> {
    return Promise.resolve(Boolean(credential.secret['token']));
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const method = SLACK_METHODS[ctx.operation];
    if (!method) {
      throw new ConduitError(ErrorCode.invalidRequest, `unsupported Slack operation: ${ctx.operation}`, 400);
    }
    const token = ctx.credential.secret['token'];
    if (!token) {
      throw new ConduitError(ErrorCode.invalidRequest, 'Slack connection is missing a bot token', 400);
    }

    const isGet = method.httpMethod === 'GET';
    const url = new URL(`${SLACK_API_BASE}/${method.apiMethod}`);
    if (isGet) {
      for (const [key, value] of Object.entries(ctx.args)) {
        url.searchParams.set(key, String(value));
      }
    }

    const init: RequestInit = {
      method: method.httpMethod,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
    };
    if (!isGet) {
      init.body = JSON.stringify(ctx.args);
    }
    const response = await fetch(url, init);

    const data = (await response.json().catch(() => ({ ok: false, error: 'invalid_json' }))) as {
      ok?: boolean;
    };
    return { status: data.ok ? 'ok' : 'error', data };
  }

  mapError(error: unknown): ConduitError {
    if (error instanceof ConduitError) {
      return error;
    }
    return new ConduitError(
      ErrorCode.internalError,
      `Slack request failed: ${error instanceof Error ? error.message : String(error)}`,
      502,
    );
  }
}
