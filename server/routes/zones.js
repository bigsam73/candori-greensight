/**
 * Golf Course Zone Management (Ontology Phase 1)
 * 
 * 계층구조: GolfClub → Course → Hole → Zone
 * Zone 유형: green, fairway, rough, tee, bunker, water_hazard, cart_path, clubhouse
 * 
 * 각 Zone은:
 * - 지도상 폴리곤 경계를 가짐
 * - 독립적 NDVI/식생지수 추적
 * - 관리 작업 기록 연결
 */
const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const db = require("../services/database");

const dataDir = path.join(__dirname, "..", "data");
const zonesFile = path.join(dataDir, "zones.json");

function loadZones() {
  if (fs.existsSync(zonesFile)) {
    try { return JSON.parse(fs.readFileSync(zonesFile, "utf-8")); } catch (e) {}
  }
  return { zones: [], actions: [] };
}

function saveZones(data) {
  fs.writeFileSync(zonesFile, JSON.stringify(data, null, 2), "utf-8");
}

// Zone 유형 정의
const ZONE_TYPES = [
  { id: "green", name: "그린", color: "#4ade80", description: "퍼팅 그린" },
  { id: "fairway", name: "페어웨이", color: "#86efac", description: "페어웨이" },
  { id: "tee", name: "티잉 그라운드", color: "#a78bfa", description: "티 박스" },
  { id: "rough", name: "러프", color: "#fbbf24", description: "러프 구역" },
  { id: "bunker", name: "벙커", color: "#fcd34d", description: "샌드 벙커" },
  { id: "water", name: "워터 해저드", color: "#38bdf8", description: "연못/개울" },
  { id: "cart_path", name: "카트도로", color: "#9ca3af", description: "카트 경로" },
  { id: "practice", name: "연습장", color: "#2dd4bf", description: "드라이빙 레인지/연습 그린" },
  { id: "landscape", name: "조경", color: "#f472b6", description: "조경/화단" },
  { id: "clubhouse", name: "클럽하우스", color: "#6b7280", description: "건물/시설" },
];

// GET /api/zones/types - 구역 유형 목록
router.get("/types", (req, res) => {
  res.json(ZONE_TYPES);
});

// GET /api/zones/:courseId - 골프장의 구역 목록
router.get("/:courseId", (req, res) => {
  const courseId = Number(req.params.courseId);
  const data = loadZones();
  const zones = data.zones.filter((z) => z.course_id === courseId);
  res.json({ ok: true, count: zones.length, zones });
});

// POST /api/zones/:courseId - 구역 추가
router.post("/:courseId", (req, res) => {
  const courseId = Number(req.params.courseId);
  const { name, type, hole_number, course_name, boundary, center, area_sqm, notes } = req.body;

  if (!name || !type || !boundary) {
    return res.status(400).json({ error: "name, type, boundary는 필수입니다" });
  }

  const data = loadZones();
  const zone = {
    id: Date.now(),
    course_id: courseId,
    name,
    type,
    hole_number: hole_number || null,
    course_name: course_name || null,
    boundary,  // [[lat,lng], ...]
    center: center || null,
    area_sqm: area_sqm || null,
    notes: notes || "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  data.zones.push(zone);
  saveZones(data);

  res.json({ ok: true, message: "구역 추가 완료", zone });
});

// PUT /api/zones/:courseId/:zoneId - 구역 수정
router.put("/:courseId/:zoneId", (req, res) => {
  const zoneId = Number(req.params.zoneId);
  const data = loadZones();
  const zone = data.zones.find((z) => z.id === zoneId);

  if (!zone) return res.status(404).json({ error: "구역을 찾을 수 없습니다" });

  const allowed = ["name", "type", "hole_number", "course_name", "boundary", "center", "area_sqm", "notes"];
  allowed.forEach((key) => {
    if (req.body[key] !== undefined) zone[key] = req.body[key];
  });
  zone.updated_at = new Date().toISOString();
  saveZones(data);

  res.json({ ok: true, message: "구역 수정 완료", zone });
});

// DELETE /api/zones/:courseId/:zoneId - 구역 삭제
router.delete("/:courseId/:zoneId", (req, res) => {
  const zoneId = Number(req.params.zoneId);
  const data = loadZones();
  const idx = data.zones.findIndex((z) => z.id === zoneId);
  if (idx === -1) return res.status(404).json({ error: "구역을 찾을 수 없습니다" });

  data.zones.splice(idx, 1);
  // 관련 작업도 삭제
  data.actions = data.actions.filter((a) => a.zone_id !== zoneId);
  saveZones(data);

  res.json({ ok: true, message: "구역 삭제 완료" });
});

// ── 관리 작업 (Action) ──

// POST /api/zones/:courseId/:zoneId/actions - 관리 작업 기록
router.post("/:courseId/:zoneId/actions", (req, res) => {
  const zoneId = Number(req.params.zoneId);
  const courseId = Number(req.params.courseId);
  const { type, date, description, worker, cost, ndvi_before, ndvi_after } = req.body;

  const ACTION_TYPES = ["irrigation", "fertilization", "mowing", "pest_control", "aeration", "topdressing", "overseeding", "repair", "other"];
  if (!type || !ACTION_TYPES.includes(type)) {
    return res.status(400).json({ error: `유효한 작업 유형: ${ACTION_TYPES.join(", ")}` });
  }

  const data = loadZones();
  const action = {
    id: Date.now(),
    zone_id: zoneId,
    course_id: courseId,
    type,
    date: date || new Date().toISOString().split("T")[0],
    description: description || "",
    worker: worker || "",
    cost: cost || null,
    ndvi_before: ndvi_before || null,
    ndvi_after: ndvi_after || null,
    created_at: new Date().toISOString(),
  };

  data.actions.push(action);
  saveZones(data);

  res.json({ ok: true, message: "작업 기록 추가 완료", action });
});

// GET /api/zones/:courseId/:zoneId/actions - 구역의 작업 이력
router.get("/:courseId/:zoneId/actions", (req, res) => {
  const zoneId = Number(req.params.zoneId);
  const data = loadZones();
  const actions = data.actions
    .filter((a) => a.zone_id === zoneId)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  res.json({ ok: true, count: actions.length, actions });
});

// GET /api/zones/ontology/:courseId - 온톨로지 뷰 (계층구조)
router.get("/ontology/:courseId", (req, res) => {
  const courseId = Number(req.params.courseId);
  const data = loadZones();
  const zones = data.zones.filter((z) => z.course_id === courseId);
  const actions = data.actions.filter((a) => a.course_id === courseId);

  // 계층구조로 변환: 코스 → 홀 → 구역
  const courseGroups = {};
  zones.forEach((z) => {
    const courseName = z.course_name || "기본 코스";
    const holeNum = z.hole_number || "공용";

    if (!courseGroups[courseName]) courseGroups[courseName] = {};
    if (!courseGroups[courseName][holeNum]) courseGroups[courseName][holeNum] = [];

    const zoneActions = actions.filter((a) => a.zone_id === z.id);
    courseGroups[courseName][holeNum].push({
      ...z,
      action_count: zoneActions.length,
      last_action: zoneActions[0] || null,
    });
  });

  res.json({
    ok: true,
    course_id: courseId,
    total_zones: zones.length,
    total_actions: actions.length,
    ontology: courseGroups,
  });
});

module.exports = router;
