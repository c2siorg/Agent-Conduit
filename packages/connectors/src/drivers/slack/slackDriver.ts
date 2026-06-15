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
 * SlackDriver — REFERENCE connector. Use this (and GitHub) as the pattern for new drivers.
 * @remarks Scaffold — operation logic stubbed.
 */
export class SlackDriver implements PlatformDriver {
  readonly platform = 'slack';

  readonly supportedOperations: OperationDescriptor[] = [
    { name: 'post_message', description: 'Post a message to a channel.' },
    { name: 'list_channels', description: 'List channels visible to the credential.' },
  ];

  readonly supportedAuthMethods: CredentialAuthMethod[] = ['bearer'];

  validateCredential(_credential: PlatformCredential): Promise<boolean> {
    throw new Error('SlackDriver.validateCredential not implemented');
  }
  execute(_ctx: ExecutionContext): Promise<ExecutionResult> {
    throw new Error('SlackDriver.execute not implemented');
  }
  mapError(_error: unknown): ConduitError {
    throw new Error('SlackDriver.mapError not implemented');
  }
}
