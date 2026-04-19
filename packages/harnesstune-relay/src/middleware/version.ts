import { createMiddleware } from 'hono/factory';

const MIN_AGENT_VERSION = '0.1.0';

function isVersionBelow(version: string, minimum: string): boolean {
  const [aMaj, aMin, aPat] = version.split('.').map(Number);
  const [bMaj, bMin, bPat] = minimum.split('.').map(Number);
  if (aMaj !== bMaj) return aMaj < bMaj;
  if (aMin !== bMin) return aMin < bMin;
  return aPat < bPat;
}

export const versionMiddleware = createMiddleware(async (c, next) => {
  const agentVersion = c.req.header('X-Agent-Version');
  if (agentVersion && isVersionBelow(agentVersion, MIN_AGENT_VERSION)) {
    return c.json({
      error: 'Agent version too old',
      minimum: MIN_AGENT_VERSION,
      current: agentVersion,
      message: `Please upgrade to at least v${MIN_AGENT_VERSION}: npm install -g harnesstune-agent@latest`,
    }, 426);
  }
  await next();
});
