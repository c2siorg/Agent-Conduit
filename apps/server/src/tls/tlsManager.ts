import type { TlsConfig } from '../config/configSchema.js';

/** HTTPS server materials. */
export interface TlsServerOptions {
  cert: string;
  key: string;
  /** mTLS client-CA bundle when `security.mtls.enabled`. */
  ca?: string;
  requestCert?: boolean;
}

/**
 * TlsManager — provisions HTTPS materials from a file or via ACME (Let's Encrypt, `acme-client`),
 * and monitors cert expiry (alerts `expiryAlertDays` before expiry → a security event). mTLS is opt-in.
 * @remarks Stub.
 */
export interface TlsManager {
  getServerOptions(): Promise<TlsServerOptions>;
  /** Start the periodic cert-expiry monitor. */
  startExpiryMonitor(): void;
}

/** Build a TLS manager from config. @remarks Stub. */
export function createTlsManager(_config: TlsConfig): TlsManager {
  throw new Error('createTlsManager not implemented');
}
