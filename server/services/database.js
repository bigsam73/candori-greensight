/**
 * SQLite Database Service
 * 골프장 및 NDVI 데이터 저장/관리
 */
const path = require("path");

let db = null;

// Use better-sqlite3 if available, otherwise fallback to JSON file storage
function getDb() {
  if (db) return db;

  try {
    const Database = require("better-sqlite3");
    db = new Database(path.join(__dirname, "..", "data", "golf_ndvi.db"));
    db._type = "sqlite";
    return db;
  } catch (e) {
    // Fallback: JSON file-based storage
    console.log("[DB] SQLite 미설치, JSON 파일 기반 저장소 사용");
    db = createJsonStore();
    return db;
  }
}

function createJsonStore() {
  const fs = require("fs");
  const dataDir = path.join(__dirname, "..", "data");
  const dbFile = path.join(dataDir, "golf_ndvi.json");

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  let data = {
    golf_courses: [],
    ndvi_records: [],
    zone_ndvi: [],
    alerts: [],
  };

  if (fs.existsSync(dbFile)) {
    try {
      data = JSON.parse(fs.readFileSync(dbFile, "utf-8"));
    } catch (e) {
      /* use default */
    }
  }

  function save() {
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), "utf-8");
  }

  return {
    _type: "json",
    _data: data,
    _save: save,
    prepare: () => ({
      run: () => {},
      all: () => [],
      get: () => null,
    }),
  };
}

function initialize() {
  const database = getDb();

  if (database._type === "sqlite") {
    database.exec(`
      CREATE TABLE IF NOT EXISTS golf_courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        name_en TEXT,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        address TEXT,
        region TEXT,
        holes INTEGER DEFAULT 18,
        area_sqm REAL,
        boundary TEXT,
        zones TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ndvi_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        satellite TEXT NOT NULL,
        ndvi_mean REAL,
        ndvi_min REAL,
        ndvi_max REAL,
        ndvi_std REAL,
        cloud_cover REAL,
        ndvi_image_url TEXT,
        rgb_image_url TEXT,
        raw_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (course_id) REFERENCES golf_courses(id)
      );

      CREATE TABLE IF NOT EXISTS zone_ndvi (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id INTEGER NOT NULL,
        zone_name TEXT NOT NULL,
        zone_type TEXT,
        ndvi_mean REAL,
        ndvi_min REAL,
        ndvi_max REAL,
        health_status TEXT,
        FOREIGN KEY (record_id) REFERENCES ndvi_records(id)
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        course_id INTEGER NOT NULL,
        zone_name TEXT,
        alert_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        ndvi_value REAL,
        threshold REAL,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (course_id) REFERENCES golf_courses(id)
      );

      CREATE INDEX IF NOT EXISTS idx_ndvi_course_date ON ndvi_records(course_id, date);
      CREATE INDEX IF NOT EXISTS idx_alerts_course ON alerts(course_id, is_read);
    `);
  } else {
    database._save();
  }

  // Insert sample Korean golf courses
  seedGolfCourses(database);

  console.log("[DB] 데이터베이스 초기화 완료");
}

function seedGolfCourses(database) {
  if (database._type === "sqlite") {
    const count = database
      .prepare("SELECT COUNT(*) as cnt FROM golf_courses")
      .get();
    if (count.cnt > 0) return;

    const insert = database.prepare(`
      INSERT INTO golf_courses (name, name_en, lat, lng, address, region, holes, area_sqm, boundary, zones)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const courses = getSampleCourses();
    const insertMany = database.transaction((courses) => {
      for (const c of courses) {
        insert.run(
          c.name,
          c.name_en,
          c.lat,
          c.lng,
          c.address,
          c.region,
          c.holes,
          c.area_sqm,
          JSON.stringify(c.boundary),
          JSON.stringify(c.zones)
        );
      }
    });
    insertMany(courses);

    // Seed sample NDVI data
    seedNDVIData(database);
  } else {
    if (database._data.golf_courses.length > 0) return;
    const courses = getSampleCourses();
    database._data.golf_courses = courses.map((c, i) => ({
      id: i + 1,
      ...c,
    }));
    seedNDVIData(database);
    database._save();
  }
}

function getSampleCourses() {
  // ─── 좌표 검증 완료 (2026-06-06 기준) ───
  return [
    // ===== 수도권 =====
    {
      name: "남서울컨트리클럽",
      name_en: "Nam Seoul CC",
      lat: 37.3822, lng: 127.0828,
      address: "경기도 성남시 분당구 판교백현로 161",
      region: "경기", holes: 27, area_sqm: 990000,
      boundary: [[37.378,127.078],[37.378,127.088],[37.386,127.088],[37.386,127.078]],
      zones: [
        { name: "동코스 페어웨이", type: "fairway", center: [37.380,127.080] },
        { name: "서코스 페어웨이", type: "fairway", center: [37.383,127.084] },
        { name: "남코스 페어웨이", type: "fairway", center: [37.385,127.082] },
      ],
    },
    {
      name: "안양컨트리클럽",
      name_en: "Anyang CC",
      lat: 37.3393, lng: 126.9399,
      address: "경기도 군포시 군포로 364",
      region: "경기", holes: 18, area_sqm: 660000,
      boundary: [[37.335,126.935],[37.335,126.945],[37.343,126.945],[37.343,126.935]],
      zones: [
        { name: "프론트 나인", type: "fairway", center: [37.337,126.938] },
        { name: "백 나인", type: "fairway", center: [37.341,126.942] },
      ],
    },
    {
      name: "스카이72 골프클럽",
      name_en: "Sky72 GC (Club72)",
      lat: 37.4570, lng: 126.4893,
      address: "인천광역시 중구 공항동로 392",
      region: "인천", holes: 72, area_sqm: 2500000,
      boundary: [[37.450,126.482],[37.450,126.497],[37.464,126.497],[37.464,126.482]],
      zones: [
        { name: "오션 코스", type: "fairway", center: [37.453,126.485] },
        { name: "하늘 코스", type: "fairway", center: [37.456,126.489] },
        { name: "바다 코스", type: "fairway", center: [37.459,126.492] },
        { name: "드림 코스", type: "fairway", center: [37.462,126.495] },
      ],
    },
    // ===== 제주 =====
    {
      name: "제주 나인브릿지",
      name_en: "Jeju Nine Bridges",
      lat: 33.3266, lng: 126.3809,
      address: "제주특별자치도 서귀포시 안덕면 광평로 34-156",
      region: "제주", holes: 18, area_sqm: 1200000,
      boundary: [[33.322,126.376],[33.322,126.386],[33.331,126.386],[33.331,126.376]],
      zones: [
        { name: "프론트 나인", type: "fairway", center: [33.324,126.378] },
        { name: "백 나인", type: "fairway", center: [33.328,126.383] },
      ],
    },
    {
      name: "블랙스톤 골프클럽",
      name_en: "Blackstone GC",
      lat: 33.3527, lng: 126.2995,
      address: "제주특별자치도 제주시 한림읍 한창로 925-122",
      region: "제주", holes: 18, area_sqm: 950000,
      boundary: [[33.349,126.295],[33.349,126.304],[33.357,126.304],[33.357,126.295]],
      zones: [
        { name: "메인 코스", type: "fairway", center: [33.351,126.298] },
        { name: "오션뷰 코스", type: "fairway", center: [33.354,126.302] },
      ],
    },
    // ===== 경기 남부 =====
    {
      name: "해슬리 나인브릿지",
      name_en: "Haesley Nine Bridges",
      lat: 37.2830, lng: 127.6050,
      address: "경기도 여주시 명품1로 76",
      region: "경기", holes: 18, area_sqm: 850000,
      boundary: [[37.279,127.600],[37.279,127.610],[37.287,127.610],[37.287,127.600]],
      zones: [
        { name: "프론트 나인", type: "fairway", center: [37.281,127.603] },
        { name: "백 나인", type: "fairway", center: [37.285,127.607] },
      ],
    },
    {
      name: "파인크리크 골프클럽",
      name_en: "Pine Creek GC",
      lat: 37.0962, lng: 127.2583,
      address: "경기도 안성시 양성면 안성맞춤대로 2417-13",
      region: "경기", holes: 18, area_sqm: 720000,
      boundary: [[37.092,127.254],[37.092,127.263],[37.100,127.263],[37.100,127.254]],
      zones: [
        { name: "밸리 코스", type: "fairway", center: [37.094,127.257] },
        { name: "힐 코스", type: "fairway", center: [37.098,127.261] },
      ],
    },
    // ===== 강원 평창 =====
    {
      name: "알펜시아700 골프클럽",
      name_en: "Alpensia 700 GC",
      lat: 37.6539, lng: 128.6855,
      address: "강원특별자치도 평창군 대관령면 솔봉로 325",
      region: "강원", holes: 18, area_sqm: 920000,
      boundary: [[37.650,128.681],[37.650,128.690],[37.658,128.690],[37.658,128.681]],
      zones: [
        { name: "밸리 코스", type: "fairway", center: [37.652,128.684] },
        { name: "마운틴 코스", type: "fairway", center: [37.656,128.688] },
      ],
    },
    {
      name: "용평리조트 골프클럽",
      name_en: "Yongpyong Resort GC",
      lat: 37.6447, lng: 128.6825,
      address: "강원특별자치도 평창군 대관령면 올림픽로 715",
      region: "강원", holes: 27, area_sqm: 1100000,
      boundary: [[37.640,128.677],[37.640,128.688],[37.649,128.688],[37.649,128.677]],
      zones: [
        { name: "레이크 코스", type: "fairway", center: [37.643,128.680] },
        { name: "마운틴 코스", type: "fairway", center: [37.646,128.685] },
      ],
    },
    // ===== 강원 홍천 =====
    {
      name: "비발디파크CC",
      name_en: "Vivaldi Park CC",
      lat: 37.6575, lng: 127.6902,
      address: "강원특별자치도 홍천군 서면 한치골길 262",
      region: "강원", holes: 18, area_sqm: 780000,
      boundary: [[37.653,127.686],[37.653,127.695],[37.662,127.695],[37.662,127.686]],
      zones: [
        { name: "마운틴 코스", type: "fairway", center: [37.656,127.689] },
        { name: "밸리 코스", type: "fairway", center: [37.659,127.692] },
      ],
    },
    {
      name: "소노펠리체CC",
      name_en: "Sono Felice CC",
      lat: 37.6893, lng: 127.6987,
      address: "강원특별자치도 홍천군 서면 한치골길 541-123",
      region: "강원", holes: 27, area_sqm: 1050000,
      boundary: [[37.685,127.694],[37.685,127.704],[37.694,127.704],[37.694,127.694]],
      zones: [
        { name: "이스트 코스", type: "fairway", center: [37.688,127.697] },
        { name: "웨스트 코스", type: "fairway", center: [37.691,127.701] },
      ],
    },
    // ===== 춘천 =====
    {
      name: "남춘천 컨트리클럽",
      name_en: "Nam Chuncheon CC",
      lat: 37.7868, lng: 127.7034,
      address: "강원특별자치도 춘천시 신동면 오봉길 156",
      region: "강원", holes: 18, area_sqm: 710000,
      boundary: [[37.783,127.699],[37.783,127.708],[37.791,127.708],[37.791,127.699]],
      zones: [
        { name: "프론트 나인", type: "fairway", center: [37.785,127.702] },
        { name: "백 나인", type: "fairway", center: [37.789,127.706] },
      ],
    },
    {
      name: "라데나 골프클럽",
      name_en: "Ladena GC",
      lat: 37.8417, lng: 127.7162,
      address: "강원특별자치도 춘천시 신동면 칠전동길 72",
      region: "강원", holes: 18, area_sqm: 760000,
      boundary: [[37.838,127.712],[37.838,127.721],[37.846,127.721],[37.846,127.712]],
      zones: [
        { name: "리지 코스", type: "fairway", center: [37.840,127.715] },
        { name: "스카이 코스", type: "fairway", center: [37.844,127.719] },
      ],
    },
    {
      name: "엘리시안 강촌CC",
      name_en: "Elysian Gangchon CC",
      lat: 37.8150, lng: 127.6650,
      address: "강원특별자치도 춘천시 남산면 백양리",
      region: "강원", holes: 18, area_sqm: 830000,
      boundary: [[37.811,127.660],[37.811,127.670],[37.819,127.670],[37.819,127.660]],
      zones: [
        { name: "레이크 코스", type: "fairway", center: [37.813,127.663] },
        { name: "밸리 코스", type: "fairway", center: [37.817,127.667] },
      ],
    },
    {
      name: "제이드팰리스 골프클럽",
      name_en: "Jade Palace GC",
      lat: 37.7950, lng: 127.6750,
      address: "강원특별자치도 춘천시 남산면 서천리 산35",
      region: "강원", holes: 18, area_sqm: 720000,
      boundary: [[37.791,127.671],[37.791,127.679],[37.799,127.679],[37.799,127.671]],
      zones: [
        { name: "가든 코스", type: "fairway", center: [37.793,127.673] },
        { name: "포레스트 코스", type: "fairway", center: [37.797,127.677] },
      ],
    },
    {
      name: "춘천 현대성우CC",
      name_en: "Chuncheon Hyundai Sungwoo CC",
      lat: 37.8600, lng: 127.7300,
      address: "강원특별자치도 춘천시 북산면 추곡리",
      region: "강원", holes: 18, area_sqm: 800000,
      boundary: [[37.856,127.726],[37.856,127.734],[37.864,127.734],[37.864,127.726]],
      zones: [
        { name: "프론트 나인", type: "fairway", center: [37.858,127.728] },
        { name: "백 나인", type: "fairway", center: [37.862,127.732] },
      ],
    },
    {
      name: "춘천 세종CC",
      name_en: "Chuncheon Sejong CC",
      lat: 37.8300, lng: 127.7500,
      address: "강원특별자치도 춘천시 동면 감정리",
      region: "강원", holes: 18, area_sqm: 690000,
      boundary: [[37.826,127.746],[37.826,127.754],[37.834,127.754],[37.834,127.746]],
      zones: [
        { name: "프론트 나인", type: "fairway", center: [37.828,127.748] },
        { name: "백 나인", type: "fairway", center: [37.832,127.752] },
      ],
    },
    // ===== 강원 기타 =====
    {
      name: "파인비치 골프링크스",
      name_en: "Pine Beach Golf Links",
      lat: 34.4350, lng: 126.5530,
      address: "전라남도 해남군 화원면 시아로 224",
      region: "전남", holes: 18, area_sqm: 850000,
      boundary: [[34.431,126.549],[34.431,126.557],[34.439,126.557],[34.439,126.549]],
      zones: [
        { name: "씨사이드 코스", type: "fairway", center: [34.433,126.551] },
        { name: "파인힐 코스", type: "fairway", center: [34.437,126.555] },
      ],
    },
    {
      name: "오크밸리CC",
      name_en: "Oak Valley CC",
      lat: 37.3984, lng: 127.8263,
      address: "강원특별자치도 원주시 지정면 오크밸리2길 66",
      region: "강원", holes: 18, area_sqm: 750000,
      boundary: [[37.394,127.822],[37.394,127.831],[37.402,127.831],[37.402,127.822]],
      zones: [
        { name: "프론트 나인", type: "fairway", center: [37.396,127.825] },
        { name: "백 나인", type: "fairway", center: [37.400,127.829] },
      ],
    },
  ];
}

function seedNDVIData(database) {
  const today = new Date();
  const courses =
    database._type === "sqlite"
      ? database.prepare("SELECT id FROM golf_courses").all()
      : database._data.golf_courses.map((c) => ({ id: c.id }));

  // Generate 90 days of sample NDVI data
  for (const course of courses) {
    for (let d = 0; d < 90; d++) {
      const date = new Date(today);
      date.setDate(date.getDate() - d);
      const dateStr = date.toISOString().split("T")[0];

      // Simulate seasonal NDVI variation
      const month = date.getMonth();
      let baseLine = 0.55;
      if (month >= 3 && month <= 5) baseLine = 0.7; // Spring
      if (month >= 6 && month <= 8) baseLine = 0.8; // Summer
      if (month >= 9 && month <= 10) baseLine = 0.6; // Fall
      if (month >= 11 || month <= 1) baseLine = 0.35; // Winter

      const noise = (Math.random() - 0.5) * 0.15;
      const ndviMean = Math.max(0.1, Math.min(0.95, baseLine + noise));
      const ndviMin = Math.max(0.05, ndviMean - 0.15 - Math.random() * 0.1);
      const ndviMax = Math.min(0.98, ndviMean + 0.1 + Math.random() * 0.1);
      const ndviStd = 0.05 + Math.random() * 0.08;
      const cloudCover = Math.random() * 40;

      // Skip some days to simulate cloud cover
      if (d % 5 === 3 && Math.random() > 0.5) continue;

      // Alternate between satellites
      const satellite = d % 5 < 3 ? "Sentinel-2" : "Landsat-8";

      if (database._type === "sqlite") {
        database
          .prepare(
            `INSERT INTO ndvi_records (course_id, date, satellite, ndvi_mean, ndvi_min, ndvi_max, ndvi_std, cloud_cover)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            course.id,
            dateStr,
            satellite,
            Math.round(ndviMean * 1000) / 1000,
            Math.round(ndviMin * 1000) / 1000,
            Math.round(ndviMax * 1000) / 1000,
            Math.round(ndviStd * 1000) / 1000,
            Math.round(cloudCover * 10) / 10
          );
      } else {
        database._data.ndvi_records.push({
          id: database._data.ndvi_records.length + 1,
          course_id: course.id,
          date: dateStr,
          satellite,
          ndvi_mean: Math.round(ndviMean * 1000) / 1000,
          ndvi_min: Math.round(ndviMin * 1000) / 1000,
          ndvi_max: Math.round(ndviMax * 1000) / 1000,
          ndvi_std: Math.round(ndviStd * 1000) / 1000,
          cloud_cover: Math.round(cloudCover * 10) / 10,
        });
      }
    }
  }

  // Generate some sample alerts
  const alertTypes = [
    {
      type: "ndvi_drop",
      severity: "warning",
      msg: "NDVI 급격한 하락 감지",
    },
    {
      type: "drought_risk",
      severity: "critical",
      msg: "가뭄 스트레스 위험 구역",
    },
    { type: "recovery", severity: "info", msg: "식생 회복 추세 감지" },
  ];

  for (const course of courses.slice(0, 3)) {
    const alert =
      alertTypes[Math.floor(Math.random() * alertTypes.length)];
    if (database._type === "sqlite") {
      database
        .prepare(
          `INSERT INTO alerts (course_id, zone_name, alert_type, severity, message, ndvi_value, threshold)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          course.id,
          "페어웨이",
          alert.type,
          alert.severity,
          alert.msg,
          0.35,
          0.4
        );
    } else {
      database._data.alerts.push({
        id: database._data.alerts.length + 1,
        course_id: course.id,
        zone_name: "페어웨이",
        alert_type: alert.type,
        severity: alert.severity,
        message: alert.msg,
        ndvi_value: 0.35,
        threshold: 0.4,
        is_read: 0,
        created_at: new Date().toISOString(),
      });
    }
  }

  if (database._type === "json") {
    database._save();
  }
}

/**
 * 특정 골프장 1개에 대해 1년치(365일) NDVI 시뮬레이션 데이터 생성
 * 신규 골프장 추가 시 호출되어, 바로 분석/리포트가 가능하도록 함
 * @param {number} courseId - 골프장 ID
 * @returns {number} 생성된 레코드 수
 */
function generateYearlyNDVI(courseId) {
  const database = getDb();
  const today = new Date();
  let count = 0;

  // 위성별 관측 패턴 정의 (현실적 주기 시뮬레이션)
  const satellites = [
    { name: "Sentinel-2", weight: 3, resolution: "10m" },   // 5일 주기 → 가장 빈번
    { name: "Landsat-8",  weight: 1, resolution: "30m" },   // 16일 주기
    { name: "Landsat-9",  weight: 1, resolution: "30m" },   // 16일 주기 (8과 교차)
    { name: "HLS-Sentinel", weight: 1, resolution: "30m" }, // 2~3일 주기
    { name: "MODIS",      weight: 1, resolution: "250m" },  // 16일 합성
  ];

  for (let d = 0; d < 365; d++) {
    const date = new Date(today);
    date.setDate(date.getDate() - d);
    const dateStr = date.toISOString().split("T")[0];
    const month = date.getMonth();
    const dayOfYear = d;

    // 계절별 기본 NDVI (한국 기후 기반)
    // 봄(3~5): 식생 성장기, 여름(6~8): 최성기, 가을(9~11): 쇠퇴, 겨울(12~2): 휴면
    let baseLine;
    if (month >= 2 && month <= 4) {
      // 봄: 점진적 상승 (0.35 → 0.70)
      const springProgress = (month - 2) / 3;
      baseLine = 0.35 + springProgress * 0.35;
    } else if (month >= 5 && month <= 7) {
      // 여름: 최고점 유지 (0.70 ~ 0.85)
      baseLine = 0.75 + Math.sin(((month - 5) / 3) * Math.PI) * 0.1;
    } else if (month >= 8 && month <= 10) {
      // 가을: 점진적 하락 (0.70 → 0.35)
      const fallProgress = (month - 8) / 3;
      baseLine = 0.70 - fallProgress * 0.35;
    } else {
      // 겨울: 최저 (0.20 ~ 0.35)
      baseLine = 0.25 + Math.random() * 0.1;
    }

    // 구름으로 인한 관측 불가 시뮬레이션 (여름 장마철 빈도 높음)
    const cloudProbability = (month >= 6 && month <= 7) ? 0.5 : 0.2;
    if (Math.random() < cloudProbability) continue; // 구름으로 관측 불가

    // 위성 선택 (가중치 기반)
    let satellite;
    const totalWeight = satellites.reduce((s, sat) => s + sat.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const sat of satellites) {
      roll -= sat.weight;
      if (roll <= 0) { satellite = sat.name; break; }
    }
    if (!satellite) satellite = "Sentinel-2";

    // 각 위성 관측 주기 시뮬레이션
    if (satellite === "Sentinel-2" && d % 5 > 2) continue;      // ~5일 주기
    if (satellite === "Landsat-8" && d % 16 !== 0) continue;     // 16일 주기
    if (satellite === "Landsat-9" && d % 16 !== 8) continue;     // 16일 주기 (8과 8일 오프셋)
    if (satellite === "MODIS" && d % 16 > 0) continue;           // 16일 합성

    // NDVI 변동성 추가
    const weatherNoise = (Math.random() - 0.5) * 0.12;
    const managementBonus = Math.random() * 0.05;  // 관리 상태
    const ndviMean = Math.max(0.08, Math.min(0.95, baseLine + weatherNoise + managementBonus));
    const ndviStd = 0.04 + Math.random() * 0.06;
    const ndviMin = Math.max(0.05, ndviMean - ndviStd * 2 - Math.random() * 0.08);
    const ndviMax = Math.min(0.98, ndviMean + ndviStd * 1.5 + Math.random() * 0.06);
    const cloudCover = Math.random() * 30;

    const record = {
      course_id: courseId,
      date: dateStr,
      satellite,
      ndvi_mean: Math.round(ndviMean * 1000) / 1000,
      ndvi_min:  Math.round(ndviMin * 1000) / 1000,
      ndvi_max:  Math.round(ndviMax * 1000) / 1000,
      ndvi_std:  Math.round(ndviStd * 1000) / 1000,
      cloud_cover: Math.round(cloudCover * 10) / 10,
    };

    if (database._type === "sqlite") {
      database
        .prepare(
          `INSERT INTO ndvi_records (course_id, date, satellite, ndvi_mean, ndvi_min, ndvi_max, ndvi_std, cloud_cover)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(record.course_id, record.date, record.satellite,
             record.ndvi_mean, record.ndvi_min, record.ndvi_max,
             record.ndvi_std, record.cloud_cover);
    } else {
      record.id = database._data.ndvi_records.length + 1;
      database._data.ndvi_records.push(record);
    }
    count++;
  }

  if (database._type === "json") {
    database._save();
  }

  return count;
}

module.exports = {
  initialize,
  getDb,
  generateYearlyNDVI,
};
