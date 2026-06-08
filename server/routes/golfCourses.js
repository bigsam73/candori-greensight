const express = require("express");
const router = express.Router();
const db = require("../services/database");

// GET /api/golf-courses - 전체 골프장 목록
router.get("/", (req, res) => {
  const database = db.getDb();
  try {
    if (database._type === "sqlite") {
      const courses = database
        .prepare(
          `SELECT gc.*,
            (SELECT ndvi_mean FROM ndvi_records WHERE course_id = gc.id ORDER BY date DESC LIMIT 1) as latest_ndvi,
            (SELECT date FROM ndvi_records WHERE course_id = gc.id ORDER BY date DESC LIMIT 1) as latest_date,
            (SELECT satellite FROM ndvi_records WHERE course_id = gc.id ORDER BY date DESC LIMIT 1) as latest_satellite
          FROM golf_courses gc ORDER BY gc.name`
        )
        .all();

      res.json(
        courses.map((c) => ({
          ...c,
          boundary: JSON.parse(c.boundary || "[]"),
          zones: JSON.parse(c.zones || "[]"),
        }))
      );
    } else {
      const courses = database._data.golf_courses.map((c) => {
        const records = database._data.ndvi_records
          .filter((r) => r.course_id === c.id)
          .sort((a, b) => b.date.localeCompare(a.date));
        return {
          ...c,
          latest_ndvi: records[0]?.ndvi_mean || null,
          latest_date: records[0]?.date || null,
          latest_satellite: records[0]?.satellite || null,
        };
      });
      res.json(courses);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/golf-courses/:id - 골프장 상세
router.get("/:id", (req, res) => {
  const database = db.getDb();
  const { id } = req.params;
  try {
    let course;
    if (database._type === "sqlite") {
      course = database
        .prepare("SELECT * FROM golf_courses WHERE id = ?")
        .get(id);
      if (course) {
        course.boundary = JSON.parse(course.boundary || "[]");
        course.zones = JSON.parse(course.zones || "[]");
      }
    } else {
      course = database._data.golf_courses.find((c) => c.id === Number(id));
    }

    if (!course) return res.status(404).json({ error: "골프장을 찾을 수 없습니다" });
    res.json(course);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/golf-courses - 골프장 추가 + 1년치 NDVI 자동 생성
router.post("/", (req, res) => {
  const database = db.getDb();
  const { name, name_en, lat, lng, address, region, holes, area_sqm, boundary, zones } = req.body;

  try {
    let courseId;

    if (database._type === "sqlite") {
      const result = database
        .prepare(
          `INSERT INTO golf_courses (name, name_en, lat, lng, address, region, holes, area_sqm, boundary, zones)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          name, name_en, lat, lng, address, region,
          holes || 18, area_sqm,
          JSON.stringify(boundary || []),
          JSON.stringify(zones || [])
        );
      courseId = result.lastInsertRowid;
    } else {
      courseId = database._data.golf_courses.length + 1;
      const newCourse = {
        id: courseId,
        name, name_en, lat, lng, address, region,
        holes: holes || 18, area_sqm,
        boundary: boundary || [], zones: zones || [],
      };
      database._data.golf_courses.push(newCourse);
      database._save();
    }

    // 1년치(365일) NDVI 시뮬레이션 데이터 자동 생성
    console.log(`[NDVI] ${name}: 1년치 NDVI 데이터 생성 시작...`);
    const ndviCount = db.generateYearlyNDVI(courseId);
    console.log(`[NDVI] ${name}: ${ndviCount}건 NDVI 레코드 생성 완료`);

    res.json({
      id: courseId,
      message: "골프장 추가 완료",
      ndvi_records_generated: ndviCount,
      ndvi_period: "최근 365일",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
