function createServerConfig(env = process.env) {
  const allowedOrigins = [
    ...(env.FRONTEND_URL ? [env.FRONTEND_URL.trim()] : []),
    ...(env.WEB_ORIGIN || 'http://localhost:5173,http://localhost:3000')
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean)
  ];

  return {
    allowedOrigins,
    sosThreshold: Number(env.SOS_THRESHOLD_RWF || env.SOS_THRESHOLD_GBP || 40),
    distributorLocationMaxAgeMs: 15 * 60 * 1000,
    dispatchSearchRadiusMeters: 500,
    adminEmail: env.ADMIN_EMAIL || 'admin@tapandgo.local',
    adminPassword: env.ADMIN_PASSWORD || 'TapGoDev2026!',
    authSecret: env.AUTH_SECRET || 'local-development-secret-change-before-deploying'
  };
}

module.exports = { createServerConfig };
