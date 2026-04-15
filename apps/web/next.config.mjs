/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@portopt/types',
    '@portopt/ui',
    '@portopt/charts',
    '@portopt/three',
  ],
};

export default nextConfig;
