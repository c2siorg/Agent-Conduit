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
 * RestDriver — GENERIC driver for any REST API without a dedicated connector.
 * Covers API key / Bearer / Basic / custom-header auth; operations are declared per connection.
 * @remarks Scaffold — request logic stubbed.
 */
export class RestDriver implements PlatformDriver {
  readonly platform = 'rest';

  /** Generic: concrete operations are supplied per-connection via `adapterConfig`/`options`. */
  readonly supportedOperations: OperationDescriptor[] = [
    { name: 'request', description: 'Perform an arbitrary configured HTTP request.' },
  ];

  readonly supportedAuthMethods: CredentialAuthMethod[] = ['apiKey', 'bearer', 'basic', 'customHeader'];

  validateCredential(_credential: PlatformCredential): Promise<boolean> {
    throw new Error('RestDriver.validateCredential not implemented');
  }
  execute(_ctx: ExecutionContext): Promise<ExecutionResult> {
    throw new Error('RestDriver.execute not implemented');
  }
  mapError(_error: unknown): ConduitError {
    throw new Error('RestDriver.mapError not implemented');
  }
}
