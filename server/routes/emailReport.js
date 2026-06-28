const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");
const db = require("../services/database");
const fs = require("fs");
const path = require("path");

// 이메일 설정 저장
const configFile = path.join(__dirname, "..", "data", "email_config.json");

function loadEmailConfig() {
  if (fs.existsSync(configFile)) {
    try { return JSON.parse(fs.readFileSync(configFile, "utf-8")); } catch (e) {}
  }
  return { recipients: [], schedule: "daily", lastSent: null };
}

function saveEmailConfig(config) {
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2), "utf-8");
}

// GET /api/email/config - 이메일 설정 조회
router.get("/config", (req, res) => {
  const config = loadEmailConfig();
  res.json({
    ok: true,
    ...config,
    smtp_configured: !!(process.env.SMTP_HOST && process.env.SMTP_USER),
  });
});

// POST /api/email/config - 이메일 설정 저장
router.post("/config", (req, res) => {
  const { recipients, schedule } = req.body;
  const config = loadEmailConfig();
  if (recipients) config.recipients = recipients;
  if (schedule) config.schedule = schedule;
  saveEmailConfig(config);
  res.json({ ok: true, message: "이메일 설정 저장 완료", config });
});

// POST /api/email/send-report - 리포트 즉시 발송
router.post("/send-report", async (req, res) => {
  const { email } = req.body;
  const config = loadEmailConfig();
  const recipients = email ? [email] : config.recipients;

  if (!recipients || recipients.length === 0) {
    return res.status(400).json({ ok: false, error: "수신 이메일 주소가 없습니다" });
  }

  try {
    const report = generateReport();
    const html = buildReportHTML(report);

    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || "587");
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || smtpUser;

    if (!smtpHost || !smtpUser) {
      // SMTP 미설정: 리포트 데이터만 반환
      return res.json({
        ok: true,
        message: "SMTP 미설정 - 리포트 데이터만 생성됨",
        smtp_configured: false,
        report,
        html_preview: true,
        recipients,
      });
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });

    await transporter.sendMail({
      from: `"Candori GreenSight" <${smtpFrom}>`,
      to: recipients.join(","),
      subject: `[GreenSight] 골프장 NDVI 일일 리포트 - ${new Date().toLocaleDateString("ko-KR")}`,
      html: html,
    });

    config.lastSent = new Date().toISOString();
    saveEmailConfig(config);

    console.log(`[Email] 리포트 발송 완료 → ${recipients.join(", ")}`);
    res.json({ ok: true, message: `리포트 발송 완료 (${recipients.length}명)`, recipients });
  } catch (err) {
    console.error("[Email] 발송 실패:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/email/report-preview - 리포트 미리보기 (HTML)
router.get("/report-preview", (req, res) => {
  const report = generateReport();
  const html = buildReportHTML(report);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

// 리포트 데이터 생성
function generateReport() {
  const database = db.getDb();
  const courses = database._data.golf_courses || [];
  const records = database._data.ndvi_records || [];
  const today = new Date().toISOString().split("T")[0];

  // 각 골프장 최신 NDVI + 통계
  const courseStats = courses.map((c) => {
    const courseRecords = records.filter((r) => r.course_id === c.id);
    const sorted = courseRecords.sort((a, b) => b.date.localeCompare(a.date));
    const latest = sorted[0];
    const last7 = sorted.filter((r) => {
      const d = new Date(r.date);
      const now = new Date();
      return (now - d) / 86400000 <= 7;
    });
    const last30 = sorted.filter((r) => {
      const d = new Date(r.date);
      const now = new Date();
      return (now - d) / 86400000 <= 30;
    });

    const avg7 = last7.length > 0 ? last7.reduce((s, r) => s + r.ndvi_mean, 0) / last7.length : null;
    const avg30 = last30.length > 0 ? last30.reduce((s, r) => s + r.ndvi_mean, 0) / last30.length : null;

    // 트렌드
    let trend = "stable";
    if (last7.length >= 3 && last30.length >= 7) {
      const diff = avg7 - avg30;
      if (diff > 0.02) trend = "improving";
      else if (diff < -0.02) trend = "declining";
    }

    return {
      id: c.id,
      name: c.name,
      region: c.region,
      lat: c.lat,
      lng: c.lng,
      latest_ndvi: latest?.ndvi_mean || null,
      latest_date: latest?.date || null,
      latest_satellite: latest?.satellite || null,
      avg_7d: avg7,
      avg_30d: avg30,
      total_records: courseRecords.length,
      trend,
    };
  });

  // NDVI 순위 (높은 순)
  const ranked = [...courseStats]
    .filter((c) => c.latest_ndvi != null)
    .sort((a, b) => b.latest_ndvi - a.latest_ndvi);

  // 알림 대상 (NDVI < 0.4)
  const alerts = ranked.filter((c) => c.latest_ndvi < 0.4);

  // 전체 평균
  const validNdvi = ranked.map((c) => c.latest_ndvi);
  const overallAvg = validNdvi.length > 0 ? validNdvi.reduce((a, b) => a + b, 0) / validNdvi.length : 0;

  return {
    date: today,
    generated_at: new Date().toISOString(),
    total_courses: courses.length,
    overall_avg_ndvi: overallAvg,
    ranking: ranked,
    alerts,
    top5: ranked.slice(0, 5),
    bottom5: ranked.slice(-5).reverse(),
  };
}

function buildReportHTML(report) {
  const getNDVIColor = (n) => {
    if (n == null) return "#888";
    if (n < 0.25) return "#d32f2f";
    if (n < 0.4) return "#ff9800";
    if (n < 0.55) return "#cddc39";
    if (n < 0.7) return "#4caf50";
    return "#1b5e20";
  };

  const trendIcon = (t) => t === "improving" ? "📈" : t === "declining" ? "📉" : "➡️";
  const trendText = (t) => t === "improving" ? "개선" : t === "declining" ? "악화" : "유지";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, 'Malgun Gothic', sans-serif; background: #f5f5f5; margin: 0; padding: 20px; color: #333; }
  .container { max-width: 700px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
  .header { background: linear-gradient(135deg, #0f1117, #1a1d27); color: #fff; padding: 24px; }
  .header h1 { margin: 0; font-size: 20px; color: #4ade80; }
  .header p { margin: 4px 0 0; font-size: 12px; color: #9ba1b7; }
  .summary { display: flex; gap: 12px; padding: 16px 24px; background: #fafafa; }
  .stat { flex: 1; text-align: center; padding: 12px; background: #fff; border-radius: 8px; border: 1px solid #eee; }
  .stat-value { font-size: 24px; font-weight: 700; }
  .stat-label { font-size: 11px; color: #888; margin-top: 4px; }
  .section { padding: 16px 24px; }
  .section h2 { font-size: 15px; margin: 0 0 12px; padding-bottom: 8px; border-bottom: 1px solid #eee; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f8f8f8; padding: 8px; text-align: left; font-weight: 600; }
  td { padding: 8px; border-bottom: 1px solid #f0f0f0; }
  .ndvi-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; color: #fff; font-weight: 700; font-size: 12px; }
  .footer { padding: 16px 24px; background: #fafafa; font-size: 10px; color: #999; text-align: center; }
  .alert-row { background: #fff3e0; }
</style></head>
<body>
<div class="container">
  <div class="header">
    <h1>🌿 Candori GreenSight 일일 리포트</h1>
    <p>${report.date} 기준 | ${report.total_courses}개 골프장 | 생성: ${new Date().toLocaleString("ko-KR")}</p>
  </div>

  <div class="summary">
    <div class="stat">
      <div class="stat-value">${report.total_courses}</div>
      <div class="stat-label">관리 골프장</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color:${getNDVIColor(report.overall_avg_ndvi)}">${report.overall_avg_ndvi.toFixed(3)}</div>
      <div class="stat-label">전체 평균 NDVI</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color:${report.alerts.length > 0 ? "#d32f2f" : "#4caf50"}">${report.alerts.length}</div>
      <div class="stat-label">주의 골프장</div>
    </div>
  </div>

  ${report.alerts.length > 0 ? `
  <div class="section">
    <h2>⚠️ 주의 골프장 (NDVI < 0.4)</h2>
    <table>
      <tr><th>골프장</th><th>NDVI</th><th>날짜</th><th>위성</th></tr>
      ${report.alerts.map((c) => `
        <tr class="alert-row">
          <td><b>${c.name}</b> (${c.region || ""})</td>
          <td><span class="ndvi-badge" style="background:${getNDVIColor(c.latest_ndvi)}">${c.latest_ndvi?.toFixed(3)}</span></td>
          <td>${c.latest_date || "-"}</td>
          <td>${c.latest_satellite || "-"}</td>
        </tr>
      `).join("")}
    </table>
  </div>
  ` : ""}

  <div class="section">
    <h2>🏆 NDVI 순위 (전체)</h2>
    <table>
      <tr><th>#</th><th>골프장</th><th>NDVI</th><th>7일평균</th><th>30일평균</th><th>추세</th><th>위성</th><th>날짜</th></tr>
      ${report.ranking.map((c, i) => `
        <tr${c.latest_ndvi < 0.4 ? ' class="alert-row"' : ""}>
          <td><b>${i + 1}</b></td>
          <td>${c.name}</td>
          <td><span class="ndvi-badge" style="background:${getNDVIColor(c.latest_ndvi)}">${c.latest_ndvi?.toFixed(3)}</span></td>
          <td>${c.avg_7d?.toFixed(3) || "-"}</td>
          <td>${c.avg_30d?.toFixed(3) || "-"}</td>
          <td>${trendIcon(c.trend)} ${trendText(c.trend)}</td>
          <td>${c.latest_satellite || "-"}</td>
          <td>${c.latest_date || "-"}</td>
        </tr>
      `).join("")}
    </table>
  </div>

  <div class="footer">
    Candori GreenSight | 위성 기반 골프장 NDVI 모니터링 플랫폼<br>
    이 리포트는 자동으로 생성되었습니다 | ${new Date().toISOString()}
  </div>
</div>
</body></html>`;
}

module.exports = router;
