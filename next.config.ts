import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  images: {
    dangerouslyAllowLocalIP: true,
  },
  allowedDevOrigins: ['devroom.lan'],
};

export default nextConfig;
