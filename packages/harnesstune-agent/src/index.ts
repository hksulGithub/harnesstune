/**
 * @harnesstune/agent — Agent CLI sidecar (npx harnesstune-agent)
 *
 * Implementation in Phase 8.
 */
// SHARED_VERSION used to come from @harnesstune/shared, but that package isn't
// published to npm — inlining the constant so the agent tarball is installable
// standalone (no workspace-only dependencies).
export const SHARED_VERSION = '0.0.1';
export const AGENT_VERSION = '0.2.0';
