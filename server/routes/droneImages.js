const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const db = require("../services/database");

// 업로드 디렉토리
const uploadDir = path.join(__dirname, "..", "..", "public", "uploads", "drone");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Multer 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const courseDir = path.join(uploadDir, `course_${req.params.courseId || "unknown"}`);
    if (!fs.existsSync(courseDir)) fs.mkdirSync(courseDir, { recursive: true });
    cb(null, courseDir);
  },
  filename: (req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9가-힣._-]/g, "_");
    cb(null, `${ts}_${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5GB
  fileFilter: (req, file, cb) => {
    const allowed = [".tif", ".tiff", ".png", ".jpg", ".jpeg", ".geotiff", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`허용되지 않는 파일 형식: ${ext}`));
    }
  },
});

// 드론 영상 메타 저장소
function getDroneMetaPath() {
  return path.join(__dirname, "..", "data", "drone_images.json");
}

function loadDroneMeta() {
  const metaPath = getDroneMetaPath();
  if (fs.existsSync(metaPath)) {
    try { return JSON.parse(fs.readFileSync(metaPath, "utf-8")); } catch (e) {}
  }
  return { images: [] };
}

function saveDroneMeta(data) {
  fs.writeFileSync(getDroneMetaPath(), JSON.stringify(data, null, 2), "utf-8");
}

// 고성능 이미지 변환 (ImageProcessor 사용)
const imageProcessor = require("../services/imageProcessor");

async function convertForWeb(filePath, courseDir, filename) {
  try {
    const result = await imageProcessor.convertImage(filePath, {
      maxWidth: 4096,
      maxHeight: 4096,
      quality: 85,
      format: "png",
      outputDir: courseDir,
      generateThumb: true,
      thumbSize: 300,
    });

    const courseId = path.basename(courseDir).replace("course_", "");
    return {
      webUrl: `/uploads/drone/course_${courseId}/${result.web.filename}`,
      webSize: result.web.size,
      thumbUrl: result.thumb ? `/uploads/drone/course_${courseId}/${result.thumb.filename}` : null,
    };
  } catch (err) {
    console.error(`[Drone] 이미지 변환 실패:`, err.message);
    return null;
  }
}

// POST /api/drone/:courseId/upload - 드론 정사영상 업로드
router.post("/:courseId/upload", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "파일이 업로드되지 않았습니다" });

  const courseId = Number(req.params.courseId);
  const { name, date, bounds_sw_lat, bounds_sw_lng, bounds_ne_lat, bounds_ne_lng, description } = req.body;

  // 골프장 정보 가져오기
  const database = db.getDb();
  let course;
  if (database._type === "sqlite") {
    course = database.prepare("SELECT * FROM golf_courses WHERE id = ?").get(courseId);
  } else {
    course = database._data.golf_courses.find((c) => c.id === courseId);
  }

  if (!course) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: "골프장을 찾을 수 없습니다" });
  }

  // 바운드 계산 (사용자 입력 또는 골프장 boundary에서 자동)
  let bounds;
  if (bounds_sw_lat && bounds_sw_lng && bounds_ne_lat && bounds_ne_lng) {
    bounds = {
      sw: [parseFloat(bounds_sw_lat), parseFloat(bounds_sw_lng)],
      ne: [parseFloat(bounds_ne_lat), parseFloat(bounds_ne_lng)],
    };
  } else {
    // 골프장 boundary에서 자동 계산
    const allCoords = [];
    const boundary = course.boundary ? (typeof course.boundary === "string" ? JSON.parse(course.boundary) : course.boundary) : [];
    if (Array.isArray(boundary) && boundary.length > 0) {
      if (boundary[0].coords) {
        boundary.forEach((p) => allCoords.push(...p.coords));
      } else if (Array.isArray(boundary[0])) {
        allCoords.push(...boundary);
      }
    }
    if (allCoords.length >= 3) {
      const lats = allCoords.map((p) => p[0]);
      const lngs = allCoords.map((p) => p[1]);
      bounds = {
        sw: [Math.min(...lats), Math.min(...lngs)],
        ne: [Math.max(...lats), Math.max(...lngs)],
      };
    } else {
      const d = 0.004;
      bounds = {
        sw: [course.lat - d, course.lng - d],
        ne: [course.lat + d, course.lng + d],
      };
    }
  }

  // TIFF 등 웹 미지원 형식은 자동 변환
  const ext = path.extname(req.file.filename).toLowerCase();
  const needsConversion = [".tif", ".tiff", ".geotiff"].includes(ext);
  let webUrl = `/uploads/drone/course_${courseId}/${req.file.filename}`;
  let thumbUrl = webUrl;

  if (needsConversion || req.file.size > 10 * 1024 * 1024) {
    console.log(`[Drone] 웹 변환 시작 (${needsConversion ? "TIFF→PNG" : "대용량 리사이즈"})...`);
    const courseDir = path.join(uploadDir, `course_${courseId}`);
    const converted = await convertForWeb(req.file.path, courseDir, req.file.filename);
    if (converted) {
      webUrl = converted.webUrl;
      if (converted.thumbUrl) thumbUrl = converted.thumbUrl;
    }
  }

  const imageRecord = {
    id: Date.now(),
    course_id: courseId,
    course_name: typeof course.name === "string" ? course.name : "",
    name: name || req.file.originalname,
    description: description || "",
    date: date || new Date().toISOString().split("T")[0],
    filename: req.file.filename,
    originalname: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype,
    url: webUrl,           // 웹 표시용 (변환된 PNG)
    url_original: `/uploads/drone/course_${courseId}/${req.file.filename}`, // 원본
    url_thumb: thumbUrl,   // 썸네일
    bounds,
    uploaded_at: new Date().toISOString(),
  };

  const meta = loadDroneMeta();
  meta.images.push(imageRecord);
  saveDroneMeta(meta);

  console.log(`[Drone] 업로드 완료: ${imageRecord.name} (${Math.round(req.file.size / 1024)}KB) → course ${courseId}`);

  res.json({
    ok: true,
    message: "드론 영상 업로드 완료" + (needsConversion ? " (TIFF→PNG 변환됨)" : ""),
    image: imageRecord,
  });
});

// GET /api/drone/:courseId - 골프장의 드론 영상 목록
router.get("/:courseId", (req, res) => {
  const courseId = Number(req.params.courseId);
  const meta = loadDroneMeta();
  const images = meta.images.filter((img) => img.course_id === courseId)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  res.json({ ok: true, count: images.length, images });
});

// GET /api/drone - 전체 드론 영상 목록
router.get("/", (req, res) => {
  const meta = loadDroneMeta();
  res.json({ ok: true, count: meta.images.length, images: meta.images });
});

// DELETE /api/drone/:courseId/:imageId - 드론 영상 삭제
router.delete("/:courseId/:imageId", (req, res) => {
  const imageId = Number(req.params.imageId);
  const meta = loadDroneMeta();
  const idx = meta.images.findIndex((img) => img.id === imageId);

  if (idx === -1) return res.status(404).json({ error: "영상을 찾을 수 없습니다" });

  const image = meta.images[idx];

  // 파일 삭제
  const filePath = path.join(__dirname, "..", "..", "public", image.url);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}

  meta.images.splice(idx, 1);
  saveDroneMeta(meta);

  res.json({ ok: true, message: "드론 영상 삭제 완료" });
});

// POST /api/drone/reconvert/:imageId - 기존 이미지 재변환
router.post("/reconvert/:imageId", async (req, res) => {
  const imageId = Number(req.params.imageId);
  const meta = loadDroneMeta();
  const img = meta.images.find((i) => i.id === imageId);
  if (!img) return res.status(404).json({ error: "이미지를 찾을 수 없습니다" });

  const originalPath = path.join(__dirname, "..", "..", "public", img.url_original || img.url);
  if (!fs.existsSync(originalPath)) {
    return res.status(404).json({ error: "원본 파일을 찾을 수 없습니다" });
  }

  const courseDir = path.dirname(originalPath);
  const converted = await convertForWeb(originalPath, courseDir, path.basename(originalPath));
  if (converted) {
    if (!img.url_original) img.url_original = img.url;
    img.url = converted.webUrl;
    if (converted.thumbUrl) img.url_thumb = converted.thumbUrl;
    saveDroneMeta(meta);
    res.json({ ok: true, message: "변환 완료", url: converted.webUrl });
  } else {
    res.status(500).json({ error: "변환 실패" });
  }
});

module.exports = router;
