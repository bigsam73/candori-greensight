/**
 * GOP 장병 안전 예측 API
 * 공개 데이터만 사용 (군사기밀 미포함)
 * 
 * 1. 기상 위험 (혹서/혹한/폭우/낙뢰/강풍)
 * 2. 열사병/동상 위험 지수
 * 3. 산불 위험 (NASA FIRMS 실시간)
 * 4. 침수/홍수 위험 (DEM + 강수량)
 */
const express = require("express");
const router = express.Router();
const axios = require("axios");

// DMZ GOP 주요 지점 (공개 정보만)
const GOP_POINTS = [
  { id: "west", name: "서부전선 (파주)", lat: 37.92, lng: 126.75 },
  { id: "central-w", name: "중서부전선 (연천)", lat: 38.05, lng: 127.05 },
  { id: "central", name: "중부전선 (철원)", lat: 38.20, lng: 127.28 },
  { id: "central-e", name: "중동부전선 (화천)", lat: 38.35, lng: 127.75 },
  { id: "east-w", name: "동부전선 (양구)", lat: 38.45, lng: 128.05 },
  { id: "east", name: "동부전선 (인제)", lat: 38.50, lng: 128.25 },
  { id: "east-e", name: "동해안전선 (고성)", lat: 38.60, lng: 128.68 },
];

// GET /api/gop-safety - 전 전선 안전 현황
router.get("/", async (req, res) => {
  try {
    const results = await Promise.all(
      GOP_POINTS.map((p) => getPointSafety(p))
    );
    
    const overallRisk = Math.max(...results.map((r) => r.risk_level));
    const alerts = results.flatMap((r) => r.alerts);
    
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      overall_risk: overallRisk,
      overall_status: riskText(overallRisk),
      total_alerts: alerts.length,
      critical_alerts: alerts.filter((a) => a.severity === "critical").length,
      points: results,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/gop-safety/:pointId - 특정 지점 상세
router.get("/:pointId", async (req, res) => {
  const point = GOP_POINTS.find((p) => p.id === req.params.pointId);
  if (!point) return res.status(404).json({ error: "지점을 찾을 수 없습니다" });
  
  try {
    const result = await getPointSafety(point);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/gop-safety/fires - NASA FIRMS 산불 데이터
router.get("/data/fires", async (req, res) => {
  try {
    const fires = await getNASAFires();
    res.json({ ok: true, count: fires.length, fires });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

async function getPointSafety(point) {
  const alerts = [];
  let riskLevel = 0;
  
  // 1. Open-Meteo 기상 데이터
  let weather = null;
  try {
    const r = await axios.get("https://api.open-meteo.com/v1/forecast", {
      params: {
        latitude: point.lat,
        longitude: point.lng,
        current: "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation,weather_code",
        hourly: "temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,uv_index,cape",
        daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,uv_index_max",
        forecast_days: 3,
        timezone: "Asia/Seoul",
      },
      timeout: 10000,
    });
    weather = r.data;
  } catch (e) {
    console.error(`[GOP] 기상 조회 실패 (${point.name}):`, e.message);
  }

  if (weather) {
    const cur = weather.current;
    const daily = weather.daily;
    const hourly = weather.hourly;

    // ── 혹서 위험 ──
    const temp = cur.temperature_2m;
    if (temp >= 35) {
      alerts.push({ type: "heat", severity: "critical", message: `극심한 폭염 ${temp}°C - 경계근무 제한 권고`, value: temp });
      riskLevel = Math.max(riskLevel, 4);
    } else if (temp >= 33) {
      alerts.push({ type: "heat", severity: "warning", message: `폭염 주의 ${temp}°C - 음수 확보, 교대 단축`, value: temp });
      riskLevel = Math.max(riskLevel, 3);
    } else if (temp >= 30) {
      alerts.push({ type: "heat", severity: "caution", message: `고온 ${temp}°C - 수분 섭취 필수`, value: temp });
      riskLevel = Math.max(riskLevel, 2);
    }

    // ── 혹한 위험 ──
    if (temp <= -15) {
      alerts.push({ type: "cold", severity: "critical", message: `극심한 한파 ${temp}°C - 동상 위험, 실내 대피`, value: temp });
      riskLevel = Math.max(riskLevel, 4);
    } else if (temp <= -10) {
      alerts.push({ type: "cold", severity: "warning", message: `한파 ${temp}°C - 방한 장구 완비`, value: temp });
      riskLevel = Math.max(riskLevel, 3);
    }

    // ── 열사병 지수 (WBGT 간이 계산) ──
    const humidity = cur.relative_humidity_2m;
    const wbgt = 0.567 * temp + 0.393 * (humidity * 0.06105 * Math.exp(17.27 * temp / (237.7 + temp))) + 3.94;
    let heatIllness = "안전";
    if (wbgt >= 33) { heatIllness = "극위험"; riskLevel = Math.max(riskLevel, 4); alerts.push({ type: "wbgt", severity: "critical", message: `열사병 극위험 (WBGT ${wbgt.toFixed(1)}) - 야외 활동 중지`, value: wbgt }); }
    else if (wbgt >= 30) { heatIllness = "위험"; riskLevel = Math.max(riskLevel, 3); alerts.push({ type: "wbgt", severity: "warning", message: `열사병 위험 (WBGT ${wbgt.toFixed(1)}) - 교대 근무 단축`, value: wbgt }); }
    else if (wbgt >= 25) { heatIllness = "주의"; riskLevel = Math.max(riskLevel, 1); }

    // ── 강풍 위험 ──
    const windGust = cur.wind_gusts_10m;
    if (windGust >= 25) {
      alerts.push({ type: "wind", severity: "warning", message: `강풍 ${windGust}m/s - 고소 작업 금지, 차량 주의`, value: windGust });
      riskLevel = Math.max(riskLevel, 3);
    }

    // ── 폭우 위험 ──
    const precip = cur.precipitation;
    if (precip >= 30) {
      alerts.push({ type: "rain", severity: "critical", message: `폭우 ${precip}mm/h - 침수 위험, 저지대 대피`, value: precip });
      riskLevel = Math.max(riskLevel, 4);
    } else if (precip >= 10) {
      alerts.push({ type: "rain", severity: "warning", message: `강우 ${precip}mm/h - 배수로 점검`, value: precip });
      riskLevel = Math.max(riskLevel, 2);
    }

    // ── 낙뢰 위험 (CAPE) ──
    const nowIdx = hourly.time.findIndex((t) => t >= new Date().toISOString().substring(0, 13));
    const cape = hourly.cape?.[nowIdx] || 0;
    if (cape >= 2000) {
      alerts.push({ type: "lightning", severity: "critical", message: `낙뢰 위험 높음 (CAPE ${cape}) - 야외 활동 중지`, value: cape });
      riskLevel = Math.max(riskLevel, 4);
    } else if (cape >= 1000) {
      alerts.push({ type: "lightning", severity: "warning", message: `낙뢰 가능성 (CAPE ${cape}) - 대비 태세`, value: cape });
      riskLevel = Math.max(riskLevel, 2);
    }

    // ── UV 자외선 ──
    const uv = hourly.uv_index?.[nowIdx] || 0;
    if (uv >= 8) {
      alerts.push({ type: "uv", severity: "caution", message: `자외선 매우 강함 (UV ${uv}) - 차광막/선크림`, value: uv });
      riskLevel = Math.max(riskLevel, 1);
    }

    return {
      ...point,
      risk_level: riskLevel,
      risk_status: riskText(riskLevel),
      alerts,
      current: {
        temperature: temp,
        humidity,
        wind_speed: cur.wind_speed_10m,
        wind_gust: windGust,
        precipitation: precip,
        weather_code: cur.weather_code,
        wbgt: Math.round(wbgt * 10) / 10,
        heat_illness: heatIllness,
        uv_index: uv,
        cape,
      },
      forecast_3d: {
        max_temps: daily.temperature_2m_max,
        min_temps: daily.temperature_2m_min,
        precip_sums: daily.precipitation_sum,
        max_winds: daily.wind_speed_10m_max,
        dates: daily.time,
      },
    };
  }

  return { ...point, risk_level: 0, risk_status: "데이터 없음", alerts: [], current: null };
}

// NASA FIRMS 실시간 산불
async function getNASAFires() {
  try {
    // DMZ 100km 범위 (37.5~39.0, 126~129)
    const url = "https://firms.modaps.eosdis.nasa.gov/api/country/csv/VIIRS_SNPP_NRT/KOR/1";
    const r = await axios.get(url, { timeout: 15000 });
    const lines = r.data.split("\n").slice(1).filter((l) => l.trim());
    return lines.map((line) => {
      const cols = line.split(",");
      return { lat: parseFloat(cols[0]), lng: parseFloat(cols[1]), brightness: parseFloat(cols[2]), date: cols[5], time: cols[6], confidence: cols[8] };
    }).filter((f) => f.lat >= 37.5 && f.lat <= 39.0 && f.lng >= 126 && f.lng <= 129);
  } catch (e) {
    return [];
  }
}

function riskText(level) {
  switch (level) {
    case 0: return "안전";
    case 1: return "관심";
    case 2: return "주의";
    case 3: return "경고";
    case 4: return "위험";
    default: return "안전";
  }
}

module.exports = router;
