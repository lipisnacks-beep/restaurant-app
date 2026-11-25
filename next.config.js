/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // xlsx ships binary assets and is heavy; keep it as a Node external so it's
  // require()'d at runtime instead of bundled into the server build. (pdfkit
  // was removed in favour of pdf-lib, which is pure JS and bundles cleanly.)
  serverComponentsExternalPackages: ['xlsx', 'mongoose'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
};

module.exports = nextConfig;
