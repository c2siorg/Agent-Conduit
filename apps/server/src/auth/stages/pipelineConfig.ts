/** Config the JWT pipeline stages need (subset of the security config). */
export interface PipelineConfig {
  /** Expected `aud` for non-execute tokens (the server's issuer / base URL). */
  issuer: string;
  /** Clock-skew tolerance in seconds (reject `iat` further in the future than this). */
  clockSkewSeconds: number;
  /** jti replay-cache retention = JWT lifetime + skew. */
  jtiCacheWindowSeconds: number;
}
