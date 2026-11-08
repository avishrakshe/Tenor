import { join } from 'node:path';
import type { NextConfig } from 'next';

const root = join(process.cwd(), '..', '..');

const nextConfig: NextConfig = {
  transpilePackages: ['@tenor/rules', '@tenor/counterparty'],
  outputFileTracingRoot: root,
  outputFileTracingIncludes: { '/**': ['../../deployments/*.json'] },
  turbopack: { root },
};

export default nextConfig;
