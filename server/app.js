require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const express = require("express");
const cors = require("cors");
const path = require("path");
const cron = require("node-cron");
const db = require("./services/database");
const satelliteService = require("./services/satellite");
const golfCourseRoutes = require("./routes/golfCourses");
const ndviRoutes = require("./routes/ndvi");
const alertRoutes = require("./routes/alerts");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// API Routes
app.use("/api/golf-courses", golfCourseRoutes);
app.use("/api/ndvi", ndviRoutes);
app.use("/api/alerts", alertRoutes);

// Sentinel Hub configuration endpoint
app.get("/api/config", (req, res) => {
  res.json({
    sentinelHubClientId: process.env.SENTINEL_HUB_CLIENT_ID || "",
    sentinelHubClientSecret: process.env.SENTINEL_HUB_CLIENT_SECRET || "",
    // Copernicus Browser (free, no key needed for WMS)
    useFreeWMS: true,
    wmsUrl:
      "https://services.sentinel-hub.com/ogc/wms/",
  });
});

// Health check
app.get("/api/health", (req, res) => {
  const catalog = satelliteService.getCatalog();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    satelliteSources: catalog.map(
      (s) => `${s.name} (${s.provider} - ${s.resolution}, ${s.revisit})`
    ),
    totalSatellites: catalog.length,
    enabledSatellites: catalog.filter((s) => s.enabled).length,
  });
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// Initialize database and start server
db.initialize();

// Schedule daily NDVI data collection at 6:00 AM KST
cron.schedule(
  "0 6 * * *",
  async () => {
    console.log("[CRON] 일일 NDVI 데이터 수집 시작...");
    try {
      await satelliteService.collectDailyNDVI();
      console.log("[CRON] 일일 NDVI 데이터 수집 완료");
    } catch (err) {
      console.error("[CRON] NDVI 수집 실패:", err.message);
    }
  },
  { timezone: "Asia/Seoul" }
);

app.listen(PORT, () => {
  const catalog = satelliteService.getCatalog();
  const lines = catalog.map(
    (s) => `   * ${s.name} (${s.resolution}) - ${s.cost}`
  );
  console.log(`
========================================================
   Candori GreenSight - Golf NDVI Monitoring Platform
   Server: http://localhost:${PORT}

   Satellite Sources (${catalog.length}):
${lines.join("\n")}
========================================================
  `);
});

module.exports = app;
