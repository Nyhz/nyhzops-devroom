import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  images: {
    dangerouslyAllowLocalIP: true,
  },
};

export default nextConfig;
