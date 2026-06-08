const express = require("express");
const router = express.Router();
const db = require("../services/database");

// GET /api/alerts - 전체 알림 조회
router.get("/", (req, res) => {
  const database = db.getDb();
  const { courseId, unreadOnly } = req.query;

  try {
    if (database._type === "sqlite") {
      let sql = `
        SELECT a.*, gc.name as course_name
        FROM alerts a
        JOIN golf_courses gc ON gc.id = a.course_id
        WHERE 1=1
      `;
      const params = [];

      if (courseId) {
        sql += " AND a.course_id = ?";
        params.push(courseId);
      }
      if (unreadOnly === "true") {
        sql += " AND a.is_read = 0";
      }
      sql += " ORDER BY a.created_at DESC LIMIT 100";

      const alerts = database.prepare(sql).all(...params);
      res.json(alerts);
    } else {
      let alerts = [...database._data.alerts];
      if (courseId) {
        alerts = alerts.filter((a) => a.course_id === Number(courseId));
      }
      if (unreadOnly === "true") {
        alerts = alerts.filter((a) => !a.is_read);
      }
      alerts = alerts
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
        .slice(0, 100)
        .map((a) => {
          const course = database._data.golf_courses.find(
            (c) => c.id === a.course_id
          );
          return { ...a, course_name: course?.name };
        });
      res.json(alerts);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/alerts/:id/read - 알림 읽음 처리
router.put("/:id/read", (req, res) => {
  const database = db.getDb();
  const { id } = req.params;

  try {
    if (database._type === "sqlite") {
      database.prepare("UPDATE alerts SET is_read = 1 WHERE id = ?").run(id);
    } else {
      const alert = database._data.alerts.find((a) => a.id === Number(id));
      if (alert) {
        alert.is_read = 1;
        database._save();
      }
    }
    res.json({ message: "읽음 처리 완료" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/alerts/summary - 알림 요약
router.get("/summary", (req, res) => {
  const database = db.getDb();
  try {
    if (database._type === "sqlite") {
      const summary = database
        .prepare(
          `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread,
          SUM(CASE WHEN severity = 'critical' AND is_read = 0 THEN 1 ELSE 0 END) as critical,
          SUM(CASE WHEN severity = 'warning' AND is_read = 0 THEN 1 ELSE 0 END) as warning,
          SUM(CASE WHEN severity = 'info' AND is_read = 0 THEN 1 ELSE 0 END) as info
        FROM alerts`
        )
        .get();
      res.json(summary);
    } else {
      const alerts = database._data.alerts;
      res.json({
        total: alerts.length,
        unread: alerts.filter((a) => !a.is_read).length,
        critical: alerts.filter(
          (a) => a.severity === "critical" && !a.is_read
        ).length,
        warning: alerts.filter(
          (a) => a.severity === "warning" && !a.is_read
        ).length,
        info: alerts.filter((a) => a.severity === "info" && !a.is_read)
          .length,
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
