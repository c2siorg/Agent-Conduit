import type { ConduitError } from '@conduit/core';
import type {
  CredentialAuthMethod,
  ExecutionContext,
  ExecutionResult,
  OperationDescriptor,
  PlatformCredential,
  PlatformDriver,
} from '../../platformDriver.js';

/**
 * GitHubDriver — REFERENCE connector alongside Slack.
 * @remarks Scaffold — operation logic stubbed.
 */
export class GitHubDriver implements PlatformDriver {
  readonly platform = 'github';

  readonly supportedOperations: OperationDescriptor[] = [
    { name: 'create_issue', description: 'Open an issue in a repository.' },
    { name: 'create_pull_request', description: 'Open a pull request.' },
    { name: 'add_comment', description: 'Comment on an issue or PR.' },
  ];

  readonly supportedAuthMethods: CredentialAuthMethod[] = ['bearer'];

  validateCredential(_credential: PlatformCredential): Promise<boolean> {
    throw new Error('GitHubDriver.validateCredential not implemented');
  }
  execute(_ctx: ExecutionContext): Promise<ExecutionResult> {
    throw new Error('GitHubDriver.execute not implemented');
  }
  mapError(_error: unknown): ConduitError {
    throw new Error('GitHubDriver.mapError not implemented');
  }
}
