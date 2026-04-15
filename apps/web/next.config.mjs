/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@portopt/types',
    '@portopt/ui',
    '@portopt/charts',
    '@portopt/three',
  ],

  webpack(config, { isServer }) {
    // Enable async WebAssembly (required for wasm-pack --target web output)
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };

    // Ensure .wasm files are treated as async assets rather than inlined
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });

    // Web Workers: Next.js webpack handles `new Worker(new URL(...))` natively
    // when the worker file uses ES module syntax — no extra loader needed.
    // On the server, exclude the worker entry so Node never tries to load it.
    if (isServer) {
      config.resolve.alias['./worker'] = false;
    }

    return config;
  },
};

export default nextConfig;
