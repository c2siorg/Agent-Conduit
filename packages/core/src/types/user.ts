/**
 * A dashboard operator account (Conduit extension — gates access to the admin UI).
 *
 * Distinct from the AAP host/agent identities: a `User` authenticates a human operator to the dashboard
 * with a password, whereas hosts/agents authenticate machine identities with Ed25519 JWTs. The
 * `passwordHash` is a scrypt-derived value and is NEVER returned to any client.
 */
export interface User {
  id: string;
  username: string;
  /** scrypt-derived hash, self-describing (params + salt encoded). Server-side only; never serialized out. */
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}
