const express = require("express");
const router = express.Router();
const db = require("../services/database");
const satelliteService = require("../services/satellite");

// ──────────────────────────────────────────────────────────────────
// GET /api/ndvi/satellites - 사용 가능한 위성 카탈로그
// ──────────────────────────────────────────────────────────────────
router.get("/satellites", (req, res) => {
  const { enabled, recommended } = req.query;

  if (recommended === "true") {
    return res.json(satelliteService.getRecommended());
  }
  if (enabled === "true") {
    return res.json(satelliteService.getEnabledSatellites());
  }
  res.json(satelliteService.getCatalog());
});

// ──────────────────────────────────────────────────────────────────
// GET /api/ndvi/available-dates/:courseId - 데이터가 존재하는 날짜 목록
// 골프장 선택 시 프론트에서 호출 → 가용 날짜를 캘린더에 표시
// ──────────────────────────────────────────────────────────────────
router.get("/available-dates/:courseId", (req, res) => {
  const database = db.getDb();
  const { courseId } = req.params;
  const { days = 90, satellite } = req.query;

  try {
    if (database._type === "sqlite") {
      let sql = `
        SELECT date, satellite, ndvi_mean, ndvi_min, ndvi_max, cloud_cover
        FROM ndvi_records
        WHERE course_id = ?
          AND date >= date('now', '-${parseInt(days)} days')
      `;
      const params = [courseId];
      if (satellite) {
        sql += " AND satellite = ?";
        params.push(satellite);
      }
      sql += " ORDER BY date DESC";
      const rows = database.prepare(sql).all(...params);
      res.json(rows);
    } else {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - parseInt(days));
      const cutoffStr = cutoff.toISOString().split("T")[0];

      let records = database._data.ndvi_records
        .filter((r) => r.course_id === Number(courseId) && r.date >= cutoffStr)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((r) => ({
          date: r.date,
          satellite: r.satellite,
          ndvi_mean: r.ndvi_mean,
          ndvi_min: r.ndvi_min,
          ndvi_max: r.ndvi_max,
          cloud_cover: r.cloud_cover,
        }));

      if (satellite) {
        records = records.filter((r) => r.satellite === satellite);
      }
      res.json(records);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ndvi/course/:courseId - 특정 골프장 NDVI 시계열 데이터
router.get("/course/:courseId", (req, res) => {
  const database = db.getDb();
  const { courseId } = req.params;
  const { days = 90, satellite } = req.query;

  try {
    if (database._type === "sqlite") {
      let sql = `
        SELECT * FROM ndvi_records
        WHERE course_id = ?
          AND date >= date('now', '-${parseInt(days)} days')
      `;
      const params = [courseId];

      if (satellite) {
        sql += " AND satellite = ?";
        params.push(satellite);
      }
      sql += " ORDER BY date DESC";

      const records = database.prepare(sql).all(...params);
      res.json(records);
    } else {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - parseInt(days));
      const cutoffStr = cutoff.toISOString().split("T")[0];

      let records = database._data.ndvi_records
        .filter(
          (r) =>
            r.course_id === Number(courseId) && r.date >= cutoffStr
        )
        .sort((a, b) => b.date.localeCompare(a.date));

      if (satellite) {
        records = records.filter((r) => r.satellite === satellite);
      }
      res.json(records);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ndvi/latest - 모든 골프장 최신 NDVI
router.get("/latest", (req, res) => {
  const database = db.getDb();
  try {
    if (database._type === "sqlite") {
      const records = database
        .prepare(
          `SELECT nr.*, gc.name as course_name, gc.lat, gc.lng, gc.region
         FROM ndvi_records nr
         JOIN golf_courses gc ON gc.id = nr.course_id
         WHERE nr.date = (SELECT MAX(date) FROM ndvi_records WHERE course_id = nr.course_id)
         ORDER BY gc.name`
        )
        .all();
      res.json(records);
    } else {
      const latestByCoursee = {};
      for (const r of database._data.ndvi_records) {
        if (!latestByCoursee[r.course_id] || r.date > latestByCoursee[r.course_id].date) {
          latestByCoursee[r.course_id] = r;
        }
      }
      const records = Object.values(latestByCoursee).map((r) => {
        const course = database._data.golf_courses.find(
          (c) => c.id === r.course_id
        );
        return {
          ...r,
          course_name: course?.name,
          lat: course?.lat,
          lng: course?.lng,
          region: course?.region,
        };
      });
      res.json(records);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ndvi/compare - 골프장 간 NDVI 비교
router.get("/compare", (req, res) => {
  const database = db.getDb();
  const { courseIds, days = 30 } = req.query;

  if (!courseIds) return res.status(400).json({ error: "courseIds 필요" });

  const ids = courseIds.split(",").map(Number);
  try {
    if (database._type === "sqlite") {
      const placeholders = ids.map(() => "?").join(",");
      const records = database
        .prepare(
          `SELECT nr.*, gc.name as course_name
         FROM ndvi_records nr
         JOIN golf_courses gc ON gc.id = nr.course_id
         WHERE nr.course_id IN (${placeholders})
           AND nr.date >= date('now', '-${parseInt(days)} days')
         ORDER BY nr.date DESC, gc.name`
        )
        .all(...ids);
      res.json(records);
    } else {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - parseInt(days));
      const cutoffStr = cutoff.toISOString().split("T")[0];

      const records = database._data.ndvi_records
        .filter((r) => ids.includes(r.course_id) && r.date >= cutoffStr)
        .map((r) => {
          const course = database._data.golf_courses.find(
            (c) => c.id === r.course_id
          );
          return { ...r, course_name: course?.name };
        })
        .sort((a, b) => b.date.localeCompare(a.date));
      res.json(records);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ndvi/stats/:courseId - 통계 요약
router.get("/stats/:courseId", (req, res) => {
  const database = db.getDb();
  const { courseId } = req.params;

  try {
    if (database._type === "sqlite") {
      const stats = database
        .prepare(
          `SELECT
          COUNT(*) as total_records,
          AVG(ndvi_mean) as avg_ndvi,
          MIN(ndvi_mean) as min_ndvi,
          MAX(ndvi_mean) as max_ndvi,
          AVG(cloud_cover) as avg_cloud,
          MIN(date) as first_date,
          MAX(date) as last_date
        FROM ndvi_records WHERE course_id = ?`
        )
        .get(courseId);

      // Monthly averages
      const monthly = database
        .prepare(
          `SELECT
          strftime('%Y-%m', date) as month,
          AVG(ndvi_mean) as avg_ndvi,
          COUNT(*) as count
        FROM ndvi_records
        WHERE course_id = ?
        GROUP BY strftime('%Y-%m', date)
        ORDER BY month DESC
        LIMIT 12`
        )
        .all(courseId);

      res.json({ stats, monthly });
    } else {
      const records = database._data.ndvi_records.filter(
        (r) => r.course_id === Number(courseId)
      );
      const ndviValues = records.map((r) => r.ndvi_mean);
      const stats = {
        total_records: records.length,
        avg_ndvi:
          ndviValues.reduce((a, b) => a + b, 0) / ndviValues.length || 0,
        min_ndvi: Math.min(...ndviValues) || 0,
        max_ndvi: Math.max(...ndviValues) || 0,
        avg_cloud:
          records.reduce((a, b) => a + b.cloud_cover, 0) / records.length || 0,
        first_date: records.sort((a, b) => a.date.localeCompare(b.date))[0]
          ?.date,
        last_date: records.sort((a, b) => b.date.localeCompare(a.date))[0]
          ?.date,
      };
      res.json({ stats, monthly: [] });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ndvi/fetch-satellite - 실시간 위성 데이터 요청
router.post("/fetch-satellite", async (req, res) => {
  const { courseId, date, satelliteId } = req.body;
  const database = db.getDb();

  try {
    let course;
    if (database._type === "sqlite") {
      course = database
        .prepare("SELECT * FROM golf_courses WHERE id = ?")
        .get(courseId);
      if (course) {
        course.boundary = JSON.parse(course.boundary || "[]");
      }
    } else {
      course = database._data.golf_courses.find(
        (c) => c.id === Number(courseId)
      );
    }

    if (!course) return res.status(404).json({ error: "골프장을 찾을 수 없습니다" });

    const targetDate = date || new Date().toISOString().split("T")[0];
    const bbox = satelliteService.boundaryToBBox(
      course.boundary || [],
      course.lat,
      course.lng
    );

    // 통합 검색 (satelliteId 지정 시 해당 위성만, 아니면 전체)
    const searchResults = await satelliteService.searchAll({
      bbox,
      lat: course.lat,
      lng: course.lng,
      dateFrom: targetDate,
      dateTo: targetDate,
      satelliteId: satelliteId || null,
    });

    // Sentinel Hub NDVI 이미지 (Sentinel-2 또는 Landsat)
    let ndviImage = null;
    if (!satelliteId || satelliteId === "sentinel-2") {
      ndviImage = await satelliteService.getSentinelHubNDVI(bbox, targetDate);
    }

    // 결과 정리
    const availableSources = {};
    let bestSource = null;

    for (const [satId, data] of Object.entries(searchResults)) {
      const hasData = Array.isArray(data) ? data.length > 0 : data && !data.error;
      availableSources[satId] = {
        available: hasData,
        count: Array.isArray(data) ? data.length : hasData ? 1 : 0,
        data: hasData ? data : null,
      };
      if (hasData && !bestSource) {
        const cat = satelliteService.getCatalog().find((s) => s.id === satId);
        bestSource = cat ? cat.name : satId;
      }
    }

    res.json({
      course: course.name,
      date: targetDate,
      requested_satellite: satelliteId || "all",
      available_sources: availableSources,
      ndvi_image: ndviImage ? `data:image/png;base64,${ndviImage}` : null,
      message: bestSource
        ? `${bestSource} 데이터 사용 가능`
        : "현재 날짜에 사용 가능한 데이터가 없습니다. 날짜를 변경해 보세요.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
