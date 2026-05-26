import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/adapter-pg", "pg", "mammoth", "unpdf", "stripe", "nodemailer"],
};

export default nextConfig;
