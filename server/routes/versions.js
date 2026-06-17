const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const db = require("../services/database");

const dataDir = path.join(__dirname, "..", "data");
const versionsDir = path.join(dataDir, "versions");
const userFile = path.join(dataDir, "user_data.json");

if (!fs.existsSync(versionsDir)) fs.mkdirSync(versionsDir, { recursive: true });

// GET /api/versions - 저장된 버전 목록
router.get("/", (req, res) => {
  try {
    const files = fs.readdirSync(versionsDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();

    const versions = files.map((f) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(versionsDir, f), "utf-8"));
        return {
          filename: f,
          label: data._label || f.replace(".json", ""),
          description: data._description || "",
          saved_at: data._saved_at || "",
          course_count: data.golf_courses?.length || 0,
          size: fs.statSync(path.join(versionsDir, f)).size,
        };
      } catch (e) {
        return { filename: f, label: f, error: true };
      }
    });

    // 현재 활성 데이터 정보
    let current = null;
    if (fs.existsSync(userFile)) {
      try {
        const ud = JSON.parse(fs.readFileSync(userFile, "utf-8"));
        current = {
          saved_at: ud._saved_at,
          course_count: ud.golf_courses?.length || 0,
          version: ud._version_label || null,
        };
      } catch (e) {}
    }

    res.json({ ok: true, current, versions, count: versions.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/versions/save - 현재 상태를 버전으로 저장
router.post("/save", (req, res) => {
  const { label, description } = req.body;
  const database = db.getDb();

  try {
    const courses = database._data.golf_courses.map((c) => ({
      id: c.id,
      name: c.name,
      name_en: c.name_en,
      lat: c.lat,
      lng: c.lng,
      address: c.address,
      region: c.region,
      holes: c.holes,
      area_sqm: c.area_sqm,
      boundary: c.boundary,
      zones: c.zones,
    }));

    const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
    const safeLabel = (label || "").replace(/[^a-zA-Z0-9가-힣_-]/g, "_").substring(0, 50);
    const filename = `v_${ts}_${safeLabel || "snapshot"}.json`;

    const versionData = {
      _version: 2,
      _label: label || `버전 ${ts}`,
      _description: description || "",
      _saved_at: new Date().toISOString(),
      _course_count: courses.length,
      golf_courses: courses,
    };

    fs.writeFileSync(path.join(versionsDir, filename), JSON.stringify(versionData, null, 2), "utf-8");

    // user_data.json에도 현재 버전 라벨 기록
    if (database._saveUserData) {
      database._data._version_label = label || ts;
      database._saveUserData();
    }

    console.log(`[Version] 저장: ${filename} (${courses.length}개 골프장)`);
    res.json({ ok: true, message: "버전 저장 완료", filename, course_count: courses.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/versions/restore/:filename - 특정 버전으로 복원
router.post("/restore/:filename", (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(versionsDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ ok: false, error: "버전 파일을 찾을 수 없습니다" });
  }

  try {
    const versionData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!versionData.golf_courses || !Array.isArray(versionData.golf_courses)) {
      return res.status(400).json({ ok: false, error: "잘못된 버전 파일 형식입니다" });
    }

    // 현재 데이터를 먼저 자동 백업 (복원 전 안전장치)
    const database = db.getDb();
    if (database._saveUserData) {
      const autoBackup = `v_${new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19)}_auto_before_restore.json`;
      const currentData = {
        _version: 2,
        _label: "복원 전 자동 백업",
        _description: `${filename} 복원 직전 자동 저장`,
        _saved_at: new Date().toISOString(),
        golf_courses: database._data.golf_courses.map((c) => ({
          id: c.id, name: c.name, name_en: c.name_en, lat: c.lat, lng: c.lng,
          address: c.address, region: c.region, holes: c.holes,
          area_sqm: c.area_sqm, boundary: c.boundary, zones: c.zones,
        })),
      };
      fs.writeFileSync(path.join(versionsDir, autoBackup), JSON.stringify(currentData, null, 2), "utf-8");
    }

    // 골프장 데이터 복원
    const restoredMap = new Map(versionData.golf_courses.map((c) => [c.id, c]));
    database._data.golf_courses = database._data.golf_courses.map((c) => {
      if (restoredMap.has(c.id)) {
        return { ...c, ...restoredMap.get(c.id) };
      }
      return c;
    });
    // 새로 추가된 골프장도 복원
    const existingIds = new Set(database._data.golf_courses.map((c) => c.id));
    versionData.golf_courses.forEach((c) => {
      if (!existingIds.has(c.id)) database._data.golf_courses.push(c);
    });

    database._save();
    if (database._saveUserData) database._saveUserData();

    console.log(`[Version] 복원: ${filename} (${versionData.golf_courses.length}개 골프장)`);
    res.json({
      ok: true,
      message: `"${versionData._label}" 버전으로 복원 완료`,
      restored_courses: versionData.golf_courses.length,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/versions/:filename - 버전 삭제
router.delete("/:filename", (req, res) => {
  const filePath = path.join(versionsDir, req.params.filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true, message: "버전 삭제 완료" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/versions/export - 현재 데이터 JSON 내보내기
router.get("/export", (req, res) => {
  const database = db.getDb();
  const exportData = {
    _exported_at: new Date().toISOString(),
    _platform: "Candori GreenSight",
    golf_courses: database._data.golf_courses.map((c) => ({
      id: c.id, name: c.name, name_en: c.name_en, lat: c.lat, lng: c.lng,
      address: c.address, region: c.region, holes: c.holes,
      boundary: c.boundary, zones: c.zones,
    })),
  };
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="greensight_export_${new Date().toISOString().split("T")[0]}.json"`);
  res.json(exportData);
});

module.exports = router;
