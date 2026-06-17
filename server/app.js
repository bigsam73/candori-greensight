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
const droneRoutes = require("./routes/droneImages");
const versionRoutes = require("./routes/versions");

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
app.use("/api/drone", droneRoutes);
app.use("/api/versions", versionRoutes);

// Platform configuration endpoint (위성 인증 상태)
app.get("/api/config", (req, res) => {
  const psStatus = satelliteService.getPlanetScopeStatus();
  res.json({
    sentinelHub: {
      configured: !!(process.env.SENTINEL_HUB_CLIENT_ID && process.env.SENTINEL_HUB_CLIENT_SECRET),
    },
    planetScope: {
      configured: psStatus.configured,
      clientId: psStatus.clientId,
      // Processing API로 직접 이미지 요청 (WMS 대신)
      imageEndpoint: "/api/planet/image",
      searchEndpoint: "/api/planet/search",
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

// PlanetScope 연결 테스트
app.get("/api/planet/test", async (req, res) => {
  try {
    const result = await satelliteService.testPlanetConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PlanetScope 이미지 요청 (NDVI 또는 RGB)
app.post("/api/planet/image", async (req, res) => {
  const { bbox, date, type = "ndvi", width = 512, height = 512 } = req.body;
  try {
    const image = await satelliteService.getPlanetScopeImage(bbox, date, type, width, height);
    if (image) {
      res.json({
        ok: true,
        image: `data:image/png;base64,${image}`,
        type,
        date,
        resolution: "3m",
        satellite: "PlanetScope",
      });
    } else {
      res.json({
        ok: false,
        image: null,
        message: "PlanetScope 인증 정보가 없거나 해당 날짜/지역에 영상이 없습니다.",
        guide: "insights.planet.com → Settings → OAuth Clients 에서 키를 발급받아 .env에 입력하세요.",
      });
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PlanetScope Catalog 검색
app.post("/api/planet/search", async (req, res) => {
  const { bbox, dateFrom, dateTo } = req.body;
  try {
    const results = await satelliteService.searchPlanetScope(bbox, dateFrom, dateTo);
    res.json({ ok: true, count: results.length, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Planet Basemaps - 사용 가능한 모자이크 목록
app.get("/api/planet/basemaps", async (req, res) => {
  try {
    const mosaics = await satelliteService.listPlanetBasemaps();
    res.json({ ok: true, count: mosaics.length, mosaics });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Soil Water Content (토양수분) 조회
app.post("/api/planet/swc", async (req, res) => {
  const { bbox, date } = req.body;
  try {
    const result = await satelliteService.getSoilWaterContentImage(bbox, date);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Land Surface Temperature (지표면온도) 조회
app.post("/api/planet/lst", async (req, res) => {
  const { bbox, date } = req.body;
  try {
    const result = await satelliteService.getLandSurfaceTempImage(bbox, date);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Planet Basemaps - 타일 URL 정보 (프론트엔드에서 Leaflet 레이어로 사용)
app.get("/api/planet/basemap-tile-url", (req, res) => {
  const apiKey = process.env.PLANET_API_KEY;
  if (!apiKey) {
    return res.json({ ok: false, message: "PLANET_API_KEY not configured" });
  }
  const { mosaic } = req.query;
  const mosaicName = mosaic || "global_monthly_2026_05_mosaic";
  res.json({
    ok: true,
    tileUrl: `https://tiles.planet.com/basemaps/v1/planet-tiles/${mosaicName}/gmap/{z}/{x}/{y}.png?api_key=${apiKey}`,
    mosaicName,
    resolution: "4.77m",
    attribution: "Planet Labs Basemaps",
  });
});

// 식생 지수 카탈로그
app.get("/api/vegetation-indices", (req, res) => {
  res.json(satelliteService.getVegetationIndices());
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
