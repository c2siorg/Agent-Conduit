import { ConduitError, ErrorCode } from '@conduit/core';
import type {
  CredentialAuthMethod,
  ExecutionContext,
  ExecutionResult,
  OperationDescriptor,
  PlatformCredential,
  PlatformDriver,
} from '../../platformDriver.js';

/**
 * MockDriver — a built-in echo connector for testing the execution path end to end without an external
 * platform. It returns the operation + args (and confirms a credential was injected) so flows can be
 * verified deterministically. Always available in the registry.
 */
export class MockDriver implements PlatformDriver {
  readonly platform = 'mock';

  readonly supportedOperations: OperationDescriptor[] = [
    { name: 'echo', description: 'Echo the provided args back (testing connector).' },
  ];

  readonly supportedAuthMethods: CredentialAuthMethod[] = ['apiKey', 'bearer', 'basic', 'customHeader'];

  validateCredential(_credential: PlatformCredential): Promise<boolean> {
    return Promise.resolve(true);
  }

  execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    return Promise.resolve({
      status: 'ok',
      data: {
        operation: ctx.operation,
        echo: ctx.args,
        credentialInjected: Boolean(ctx.credential?.secret),
      },
    });
  }

  mapError(error: unknown): ConduitError {
    return new ConduitError(
      ErrorCode.internalError,
      error instanceof Error ? error.message : 'mock driver error',
      502,
    );
  }
}
