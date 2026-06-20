/**
 * Terrain/DEM/LiDAR Analysis for Golf Course Management
 * 
 * 위성 DEM: SRTM 30m / ASTER 30m (무료 API)
 * 드론 LiDAR: 사용자 업로드 (GeoTIFF DSM/DTM)
 * 
 * 분석 기능:
 * - 고도 프로필
 * - 경사도 (Slope)
 * - 배수 방향 (Aspect/Flow)
 * - 등고선 시각화
 */
const express = require("express");
const router = express.Router();
const axios = require("axios");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// LiDAR 업로드 디렉토리
const lidarDir = path.join(__dirname, "..", "..", "public", "uploads", "lidar");
if (!fs.existsSync(lidarDir)) fs.mkdirSync(lidarDir, { recursive: true });

const lidarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const courseDir = path.join(lidarDir, `course_${req.params.courseId}`);
    if (!fs.existsSync(courseDir)) fs.mkdirSync(courseDir, { recursive: true });
    cb(null, courseDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9가-힣._-]/g, "_")}`);
  },
});
const uploadLidar = multer({ storage: lidarStorage, limits: { fileSize: 5 * 1024 * 1024 * 1024 } });

// LiDAR 메타 저장소
const metaFile = path.join(__dirname, "..", "data", "lidar_data.json");
function loadLidarMeta() {
  if (fs.existsSync(metaFile)) {
    try { return JSON.parse(fs.readFileSync(metaFile, "utf-8")); } catch (e) {}
  }
  return { datasets: [] };
}
function saveLidarMeta(data) {
  fs.writeFileSync(metaFile, JSON.stringify(data, null, 2), "utf-8");
}

// ── 위성 DEM API ──

// GET /api/terrain/elevation?lat=&lng= - 단일 포인트 고도
router.get("/elevation", async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "lat, lng 필수" });

  try {
    const r = await axios.get(`https://api.opentopodata.org/v1/srtm30m?locations=${lat},${lng}`, { timeout: 10000 });
    const elev = r.data.results?.[0]?.elevation;
    res.json({ ok: true, elevation: elev, unit: "m", source: "SRTM 30m", lat: parseFloat(lat), lng: parseFloat(lng) });
  } catch (e) {
    // fallback
    try {
      const r2 = await axios.get(`https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lng}`, { timeout: 10000 });
      const elev2 = r2.data.results?.[0]?.elevation;
      res.json({ ok: true, elevation: elev2, unit: "m", source: "Open-Elevation SRTM", lat: parseFloat(lat), lng: parseFloat(lng) });
    } catch (e2) {
      res.status(500).json({ ok: false, error: "고도 조회 실패" });
    }
  }
});

// POST /api/terrain/grid - 영역 그리드 고도 (배수/경사도 분석용)
router.post("/grid", async (req, res) => {
  const { bbox, resolution = 8 } = req.body;
  if (!bbox || bbox.length !== 4) return res.status(400).json({ error: "bbox [west, south, east, north] 필수" });

  const [west, south, east, north] = bbox;
  const rows = Math.min(resolution, 20);
  const cols = Math.min(resolution, 20);

  const points = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push({
        lat: south + (north - south) * (r + 0.5) / rows,
        lng: west + (east - west) * (c + 0.5) / cols,
      });
    }
  }

  // OpenTopoData 배치 요청 (최대 100포인트)
  const locStr = points.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join("|");

  try {
    const r = await axios.get(`https://api.opentopodata.org/v1/srtm30m?locations=${locStr}`, { timeout: 30000 });
    const elevations = r.data.results?.map((p) => p.elevation) || [];

    // 그리드 데이터 구성
    const grid = [];
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const elev = elevations[idx] || 0;
        row.push(elev);
        idx++;
      }
      grid.push(row);
    }

    // 경사도/배수 계산
    const analysis = analyzeTerrainGrid(grid, rows, cols, north - south, east - west);

    res.json({
      ok: true,
      bbox,
      rows,
      cols,
      source: "SRTM 30m",
      grid,
      min_elevation: Math.min(...elevations.filter((e) => e != null)),
      max_elevation: Math.max(...elevations.filter((e) => e != null)),
      analysis,
    });
  } catch (e) {
    // rate limit 시 시뮬레이션
    console.log("[Terrain] API rate limited, using simulation");
    const simGrid = simulateTerrainGrid(rows, cols, south, west, north - south, east - west);
    res.json({
      ok: true,
      bbox,
      rows,
      cols,
      source: "시뮬레이션 (API 제한)",
      ...simGrid,
    });
  }
});

// POST /api/terrain/course/:courseId - 골프장 지형 분석
router.post("/course/:courseId", async (req, res) => {
  const courseId = Number(req.params.courseId);
  const db = require("../services/database");
  const database = db.getDb();

  let course;
  if (database._type === "sqlite") {
    course = database.prepare("SELECT * FROM golf_courses WHERE id = ?").get(courseId);
    if (course) course.boundary = JSON.parse(course.boundary || "[]");
  } else {
    course = database._data.golf_courses.find((c) => c.id === courseId);
  }
  if (!course) return res.status(404).json({ error: "골프장을 찾을 수 없습니다" });

  // bbox 계산
  let allCoords = [];
  const boundary = course.boundary || [];
  if (Array.isArray(boundary) && boundary.length > 0) {
    if (boundary[0]?.coords) {
      boundary.forEach((p) => allCoords.push(...p.coords));
    } else if (Array.isArray(boundary[0])) {
      allCoords = boundary;
    }
  }

  let bbox;
  if (allCoords.length >= 3) {
    const lats = allCoords.map((p) => p[0]);
    const lngs = allCoords.map((p) => p[1]);
    bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
  } else {
    const d = 0.004;
    bbox = [course.lng - d, course.lat - d, course.lng + d, course.lat + d];
  }

  // 그리드 고도 데이터
  const rows = 10, cols = 10;
  const [west, south, east, north] = bbox;
  const points = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points.push(`${(south + (north - south) * (r + 0.5) / rows).toFixed(6)},${(west + (east - west) * (c + 0.5) / cols).toFixed(6)}`);
    }
  }

  let grid, source, minElev, maxElev;
  try {
    const r = await axios.get(`https://api.opentopodata.org/v1/srtm30m?locations=${points.join("|")}`, { timeout: 30000 });
    const elevations = r.data.results?.map((p) => p.elevation) || [];
    grid = [];
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) { row.push(elevations[idx++] || 0); }
      grid.push(row);
    }
    source = "SRTM 30m";
    minElev = Math.min(...elevations.filter((e) => e != null));
    maxElev = Math.max(...elevations.filter((e) => e != null));
  } catch (e) {
    const sim = simulateTerrainGrid(rows, cols, south, west, north - south, east - west);
    grid = sim.grid;
    source = "시뮬레이션";
    minElev = sim.min_elevation;
    maxElev = sim.max_elevation;
  }

  const analysis = analyzeTerrainGrid(grid, rows, cols, north - south, east - west);

  // LiDAR 데이터 확인
  const lidarMeta = loadLidarMeta();
  const lidarDatasets = lidarMeta.datasets.filter((d) => d.course_id === courseId);

  res.json({
    ok: true,
    course_id: courseId,
    course_name: course.name,
    bbox,
    rows, cols,
    source,
    grid,
    min_elevation: minElev,
    max_elevation: maxElev,
    analysis,
    lidar_datasets: lidarDatasets.length,
    lidar_available: lidarDatasets.length > 0,
  });
});

// ── 지형 분석 함수 ──

function analyzeTerrainGrid(grid, rows, cols, latRange, lngRange) {
  const cellSizeM = (latRange * 111320) / rows; // 대략적 셀 크기 (미터)
  const slopes = [];
  const aspects = [];
  const drainage = { good: 0, moderate: 0, poor: 0 };

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      // 경사도 (3x3 Sobel)
      const dzdx = ((grid[r-1][c+1] + 2*grid[r][c+1] + grid[r+1][c+1]) - (grid[r-1][c-1] + 2*grid[r][c-1] + grid[r+1][c-1])) / (8 * cellSizeM);
      const dzdy = ((grid[r+1][c-1] + 2*grid[r+1][c] + grid[r+1][c+1]) - (grid[r-1][c-1] + 2*grid[r-1][c] + grid[r-1][c+1])) / (8 * cellSizeM);
      const slope = Math.atan(Math.sqrt(dzdx*dzdx + dzdy*dzdy)) * 180 / Math.PI;
      slopes.push(slope);

      // 배수 방향 (aspect)
      let aspect = Math.atan2(-dzdy, dzdx) * 180 / Math.PI;
      if (aspect < 0) aspect += 360;
      aspects.push(aspect);

      // 배수 등급
      if (slope > 2) drainage.good++;
      else if (slope > 0.5) drainage.moderate++;
      else drainage.poor++;
    }
  }

  const total = slopes.length || 1;
  return {
    slope: {
      mean: slopes.reduce((a, b) => a + b, 0) / total,
      min: Math.min(...slopes),
      max: Math.max(...slopes),
      unit: "degrees",
    },
    drainage: {
      good_pct: Math.round((drainage.good / total) * 100),
      moderate_pct: Math.round((drainage.moderate / total) * 100),
      poor_pct: Math.round((drainage.poor / total) * 100),
      description: drainage.poor / total > 0.3 ? "배수 불량 구역 다수" : drainage.good / total > 0.5 ? "배수 양호" : "보통",
    },
    cell_size_m: Math.round(cellSizeM),
  };
}

function simulateTerrainGrid(rows, cols, baseLat, baseLng, latRange, lngRange) {
  const baseElev = 100 + Math.random() * 200;
  const grid = [];
  const elevations = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const elev = baseElev + Math.sin(r * 0.5) * 15 + Math.cos(c * 0.7) * 10 + (Math.random() - 0.5) * 5;
      row.push(Math.round(elev * 10) / 10);
      elevations.push(row[row.length - 1]);
    }
    grid.push(row);
  }
  return { grid, min_elevation: Math.min(...elevations), max_elevation: Math.max(...elevations) };
}

// ── 드론 LiDAR 업로드 ──

// POST /api/terrain/lidar/:courseId/upload - LiDAR DSM/DTM 업로드
router.post("/lidar/:courseId/upload", uploadLidar.single("lidar"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "파일이 업로드되지 않았습니다" });

  const courseId = Number(req.params.courseId);
  const { name, date, data_type, gsd, description } = req.body;

  // 웹용 변환
  let webUrl = `/uploads/lidar/course_${courseId}/${req.file.filename}`;
  let thumbUrl = webUrl;

  const ext = path.extname(req.file.filename).toLowerCase();
  if ([".tif", ".tiff"].includes(ext)) {
    try {
      const sharp = require("sharp");
      const baseName = path.basename(req.file.filename, ext);
      const courseDir = path.join(lidarDir, `course_${courseId}`);

      // 웹용 PNG
      const webPath = path.join(courseDir, `${baseName}_web.png`);
      await sharp(req.file.path, { limitInputPixels: false })
        .resize(4096, 4096, { fit: "inside", withoutEnlargement: true })
        .png({ compressionLevel: 6 })
        .toFile(webPath);
      webUrl = `/uploads/lidar/course_${courseId}/${baseName}_web.png`;

      // 썸네일
      const thumbPath = path.join(courseDir, `${baseName}_thumb.jpg`);
      await sharp(req.file.path, { limitInputPixels: false })
        .resize(300, 300, { fit: "cover" })
        .jpeg({ quality: 80 })
        .toFile(thumbPath);
      thumbUrl = `/uploads/lidar/course_${courseId}/${baseName}_thumb.jpg`;

      console.log(`[LiDAR] TIFF 변환 완료: ${baseName}`);
    } catch (e) {
      console.error("[LiDAR] 변환 실패:", e.message);
    }
  }

  const dataset = {
    id: Date.now(),
    course_id: courseId,
    name: name || req.file.originalname,
    data_type: data_type || "dsm", // dsm, dtm, chm, point_cloud
    gsd: gsd || null,
    date: date || new Date().toISOString().split("T")[0],
    description: description || "",
    filename: req.file.filename,
    originalname: req.file.originalname,
    size: req.file.size,
    url: webUrl,
    url_original: `/uploads/lidar/course_${courseId}/${req.file.filename}`,
    url_thumb: thumbUrl,
    uploaded_at: new Date().toISOString(),
  };

  const meta = loadLidarMeta();
  meta.datasets.push(dataset);
  saveLidarMeta(meta);

  console.log(`[LiDAR] 업로드: ${dataset.name} (${Math.round(req.file.size / 1024)}KB) → course ${courseId}`);
  res.json({ ok: true, message: "LiDAR 데이터 업로드 완료", dataset });
});

// GET /api/terrain/lidar/:courseId - LiDAR 데이터 목록
router.get("/lidar/:courseId", (req, res) => {
  const courseId = Number(req.params.courseId);
  const meta = loadLidarMeta();
  const datasets = meta.datasets.filter((d) => d.course_id === courseId);
  res.json({ ok: true, count: datasets.length, datasets });
});

// DELETE /api/terrain/lidar/:courseId/:datasetId
router.delete("/lidar/:courseId/:datasetId", (req, res) => {
  const datasetId = Number(req.params.datasetId);
  const meta = loadLidarMeta();
  const idx = meta.datasets.findIndex((d) => d.id === datasetId);
  if (idx === -1) return res.status(404).json({ error: "데이터셋을 찾을 수 없습니다" });

  const ds = meta.datasets[idx];
  // 파일 삭제
  [ds.url, ds.url_original, ds.url_thumb].forEach((u) => {
    if (u) {
      const fp = path.join(__dirname, "..", "..", "public", u);
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
    }
  });

  meta.datasets.splice(idx, 1);
  saveLidarMeta(meta);
  res.json({ ok: true, message: "LiDAR 데이터 삭제 완료" });
});

module.exports = router;
