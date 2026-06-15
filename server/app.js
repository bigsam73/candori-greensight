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

// Platform configuration endpoint (위성 인증 상태)
app.get("/api/config", (req, res) => {
  const planetWms = satelliteService.getPlanetScopeWMSConfig();
  res.json({
    sentinelHub: {
      configured: !!(process.env.SENTINEL_HUB_CLIENT_ID && process.env.SENTINEL_HUB_CLIENT_SECRET),
    },
    planetScope: {
      configured: !!(process.env.PLANET_INSIGHTS_CLIENT_ID && process.env.PLANET_INSIGHTS_CLIENT_SECRET),
      wms: planetWms,
    },
    planetNICFI: {
      configured: !!process.env.PLANET_API_KEY,
    },
    copernicus: {
      wmsUrl: "https://sh.dataspace.copernicus.eu/ogc/wms/ed64bf38-575d-4fee-83d0-59bd0c6f80b3",
      configured: true,
    },
  });
});

// PlanetScope 이미지 요청 엔드포인트
app.post("/api/planet/image", async (req, res) => {
  const { bbox, date, type = "ndvi", width = 512, height = 512 } = req.body;
  try {
    const image = await satelliteService.getPlanetScopeImage(bbox, date, type, width, height);
    if (image) {
      res.json({ image: `data:image/png;base64,${image}`, type, date });
    } else {
      res.json({ image: null, message: "PlanetScope 인증 정보가 없거나 해당 날짜 영상이 없습니다." });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
