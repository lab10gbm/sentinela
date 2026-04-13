/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['pdfjs-dist'],
  webpack: (config) => {
    // Enable Top-level await for PDF.js 4/5
    config.experiments = {
      ...config.experiments,
      topLevelAwait: true,
    };

    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };

    return config;
  },
};

export default nextConfig;
