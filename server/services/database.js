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
  const userFile = path.join(dataDir, "user_data.json");
  const backupDir = path.join(dataDir, "backups");

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  let data = {
    golf_courses: [],
    ndvi_records: [],
    zone_ndvi: [],
    alerts: [],
  };

  // 1) 메인 DB 파일 로드
  if (fs.existsSync(dbFile)) {
    try {
      data = JSON.parse(fs.readFileSync(dbFile, "utf-8"));
    } catch (e) { /* use default */ }
  }

  // 2) 사용자 수정 데이터가 있으면 병합 (user_data가 우선)
  if (fs.existsSync(userFile)) {
    try {
      const userData = JSON.parse(fs.readFileSync(userFile, "utf-8"));
      if (userData.golf_courses && userData.golf_courses.length > 0) {
        // 사용자 수정 골프장 → 기존 데이터에 merge (id 기준)
        const userMap = new Map(userData.golf_courses.map((c) => [c.id, c]));
        data.golf_courses = data.golf_courses.map((c) => userMap.has(c.id) ? { ...c, ...userMap.get(c.id) } : c);
        // 사용자가 추가한 새 골프장 (기존에 없는 id)
        const existingIds = new Set(data.golf_courses.map((c) => c.id));
        userData.golf_courses.forEach((c) => {
          if (!existingIds.has(c.id)) data.golf_courses.push(c);
        });
        console.log(`[DB] 사용자 데이터 병합: ${userMap.size}개 골프장`);
      }
    } catch (e) {
      console.error("[DB] user_data.json 로드 실패:", e.message);
    }
  }

  function save() {
    fs.writeFileSync(dbFile, JSON.stringify(data, null, 2), "utf-8");
  }

  /**
   * 사용자가 수정한 골프장 데이터를 별도 파일에 영구 저장
   * 이 파일은 서버 재시작, seed 재생성, git pull 후에도 유지됨
   */
  function saveUserData() {
    const userCourses = data.golf_courses.map((c) => ({
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

    const userData = {
      _version: 1,
      _saved_at: new Date().toISOString(),
      _description: "사용자 수정 데이터 - 이 파일은 삭제하지 마세요",
      golf_courses: userCourses,
    };

    // 저장 전 백업 생성
    if (fs.existsSync(userFile)) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
      const backupFile = path.join(backupDir, `user_data_${ts}.json`);
      try {
        fs.copyFileSync(userFile, backupFile);
        // 오래된 백업 정리 (최근 20개만 유지)
        const backups = fs.readdirSync(backupDir)
          .filter((f) => f.startsWith("user_data_"))
          .sort()
          .reverse();
        backups.slice(20).forEach((f) => {
          try { fs.unlinkSync(path.join(backupDir, f)); } catch (_) {}
        });
      } catch (_) {}
    }

    fs.writeFileSync(userFile, JSON.stringify(userData, null, 2), "utf-8");
    console.log(`[DB] 사용자 데이터 저장: ${userCourses.length}개 골프장 → user_data.json`);
  }

  return {
    _type: "json",
    _data: data,
    _save: save,
    _saveUserData: saveUserData,
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
    // 골프장이 없으면 seed 데이터 생성
    if (database._data.golf_courses.length === 0) {
      const courses = getSampleCourses();
      database._data.golf_courses = courses.map((c, i) => ({
        id: i + 1,
        ...c,
      }));
    }

    // NDVI 레코드가 없으면 생성 (user_data 병합 후에도 NDVI가 없을 수 있음)
    if (database._data.ndvi_records.length === 0) {
      console.log("[DB] NDVI 레코드 없음 - 전체 골프장 NDVI 데이터 생성 중...");
    } else {
      // 이미 NDVI 데이터가 있으면 skip
      return;
    }
    seedNDVIData(database);
    database._save();
  }
}

function makeBoundary(lat, lng, s) {
  // 중심좌표 기준으로 s(도) 크기의 사각형 boundary 생성
  const d = s || 0.004;
  return [[lat-d, lng-d],[lat-d, lng+d],[lat+d, lng+d],[lat+d, lng-d]];
}

function getSampleCourses() {
  // ─── 좌표 검증: Nominatim + 주소 기반 지오코딩 (2026-06-17) ───
  return [
    // ===== 수도권 =====
    {
      name: "남서울컨트리클럽",
      name_en: "Nam Seoul CC",
      lat: 37.3829, lng: 127.0839,
      address: "경기도 성남시 분당구 안양판교로 161",
      region: "경기", holes: 27, area_sqm: 990000,
      boundary: makeBoundary(37.3829, 127.0839, 0.005),
      zones: [
        { name: "동코스", type: "fairway", center: [37.3815, 127.0855] },
        { name: "서코스", type: "fairway", center: [37.3840, 127.0820] },
        { name: "남코스", type: "fairway", center: [37.3805, 127.0830] },
      ],
    },
    {
      name: "안양컨트리클럽",
      name_en: "Anyang CC",
      lat: 37.3393, lng: 126.9399,
      address: "경기도 군포시 군포로 364",
      region: "경기", holes: 18, area_sqm: 660000,
      boundary: makeBoundary(37.3393, 126.9399, 0.004),
      zones: [
        { name: "프론트 나인", type: "fairway", center: [37.3380, 126.9385] },
        { name: "백 나인", type: "fairway", center: [37.3410, 126.9415] },
      ],
    },
    {
      name: "스카이72 골프클럽",
      name_en: "Sky72 GC",
      lat: 37.4804, lng: 126.4668,
      address: "인천광역시 중구 공항동로 392",
      region: "인천", holes: 72, area_sqm: 2500000,
      boundary: makeBoundary(37.4804, 126.4668, 0.008),
      zones: [
        { name: "오션 코스", type: "fairway", center: [37.478, 126.460] },
        { name: "하늘 코스", type: "fairway", center: [37.482, 126.464] },
        { name: "바다 코스", type: "fairway", center: [37.479, 126.470] },
        { name: "드림 코스", type: "fairway", center: [37.483, 126.474] },
      ],
    },
    // ===== 제주 =====
    {
      name: "제주 나인브릿지",
      name_en: "Jeju Nine Bridges",
      lat: 33.3278, lng: 126.3814,
      address: "제주특별자치도 서귀포시 안덕면 광평로 34-156",
      region: "제주", holes: 18, area_sqm: 1200000,
      boundary: makeBoundary(33.3278, 126.3814, 0.005),
      zones: [
        { name: "프론트 나인", type: "fairway", center: [33.3260, 126.3795] },
        { name: "백 나인", type: "fairway", center: [33.3295, 126.3835] },
      ],
    },
    {
      name: "블랙스톤 골프클럽",
      name_en: "Blackstone GC",
      lat: 33.2945, lng: 126.3115,
      address: "제주특별자치도 서귀포시 안덕면 산록남로 762-16",
      region: "제주", holes: 18, area_sqm: 950000,
      boundary: makeBoundary(33.2945, 126.3115, 0.004),
      zones: [
        { name: "메인 코스", type: "fairway", center: [33.2935, 126.3100] },
        { name: "오션뷰 코스", type: "fairway", center: [33.2960, 126.3130] },
      ],
    },
    // ===== 경기 남부 =====
    {
      name: "해슬리 나인브릿지",
      name_en: "Haesley Nine Bridges",
      lat: 37.2520, lng: 127.2640,
      address: "경기도 이천시 모가면 사실로 36",
      region: "경기", holes: 18, area_sqm: 850000,
      boundary: makeBoundary(37.2520, 127.2640, 0.005),
      zones: [
        { name: "프론트 나인", type: "fairway", center: [37.2505, 127.2625] },
        { name: "백 나인", type: "fairway", center: [37.2535, 127.2660] },
      ],
    },
    {
      name: "파인크리크 골프클럽",
      name_en: "Pine Creek GC",
      lat: 36.9720, lng: 127.2494,
      address: "경기도 안성시 양성면 안성맞춤대로 2417-13",
      region: "경기", holes: 18, area_sqm: 720000,
      boundary: makeBoundary(36.9720, 127.2494, 0.004),
      zones: [
        { name: "밸리 코스", type: "fairway", center: [36.9710, 127.2480] },
        { name: "힐 코스", type: "fairway", center: [36.9735, 127.2510] },
      ],
    },
    // ===== 강원 평창 =====
    {
      name: "알펜시아700 골프클럽",
      name_en: "Alpensia 700 GC",
      lat: 37.6539, lng: 128.6855,
      address: "강원특별자치도 평창군 대관령면 솔봉로 325",
      region: "강원", holes: 18, area_sqm: 920000,
      boundary: makeBoundary(37.6539, 128.6855, 0.004),
      zones: [
        { name: "밸리 코스", type: "fairway", center: [37.6525, 128.6840] },
        { name: "마운틴 코스", type: "fairway", center: [37.6555, 128.6870] },
      ],
    },
    {
      name: "용평리조트 골프클럽",
      name_en: "Yongpyong Resort GC",
      lat: 37.6647, lng: 128.7025,
      address: "강원특별자치도 평창군 대관령면 올림픽로 715",
      region: "강원", holes: 27, area_sqm: 1100000,
      boundary: makeBoundary(37.6647, 128.7025, 0.005),
      zones: [
        { name: "레이크 코스", type: "fairway", center: [37.6630, 128.7010] },
        { name: "마운틴 코스", type: "fairway", center: [37.6665, 128.7040] },
      ],
    },
    // ===== 강원 홍천 =====
    {
      name: "비발디파크CC",
      name_en: "Vivaldi Park CC",
      lat: 37.6313, lng: 127.6695,
      address: "강원특별자치도 홍천군 서면 한치골길 262",
      region: "강원", holes: 18, area_sqm: 780000,
      boundary: makeBoundary(37.6313, 127.6695, 0.004),
      zones: [
        { name: "마운틴 코스", type: "fairway", center: [37.6300, 127.6680] },
        { name: "밸리 코스", type: "fairway", center: [37.6325, 127.6710] },
      ],
    },
    {
      name: "소노펠리체CC",
      name_en: "Sono Felice CC",
      lat: 37.6380, lng: 127.6750,
      address: "강원특별자치도 홍천군 서면 한치골길 541-123",
      region: "강원", holes: 27, area_sqm: 1050000,
      boundary: makeBoundary(37.6380, 127.6750, 0.005),
      zones: [
        { name: "이스트 코스", type: "fairway", center: [37.6365, 127.6735] },
        { name: "웨스트 코스", type: "fairway", center: [37.6395, 127.6770] },
      ],
    },
    // ===== 춘천 =====
    {
      name: "남춘천 컨트리클럽",
      name_en: "Nam Chuncheon CC",
      lat: 37.7868, lng: 127.7034,
      address: "강원특별자치도 춘천시 신동면 오봉길 156",
      region: "강원", holes: 18, area_sqm: 710000,
      boundary: makeBoundary(37.7868, 127.7034, 0.004),
      zones: [
        { name: "프론트 나인", type: "fairway", center: [37.7855, 127.7020] },
        { name: "백 나인", type: "fairway", center: [37.7880, 127.7050] },
      ],
    },
    {
      name: "라데나 골프클럽",
      name_en: "Ladena GC",
      lat: 37.8417, lng: 127.7162,
      address: "강원특별자치도 춘천시 신동면 칠전동길 72",
      region: "강원", holes: 18, area_sqm: 760000,
      boundary: makeBoundary(37.8417, 127.7162, 0.004),
      zones: [
        { name: "리지 코스", type: "fairway", center: [37.8405, 127.7150] },
        { name: "스카이 코스", type: "fairway", center: [37.8430, 127.7175] },
      ],
    },
    {
      name: "엘리시안 강촌CC",
      name_en: "Elysian Gangchon CC",
      lat: 37.7991, lng: 127.6188,
      address: "강원특별자치도 춘천시 남산면 강촌리",
      region: "강원", holes: 18, area_sqm: 830000,
      boundary: makeBoundary(37.7991, 127.6188, 0.004),
      zones: [
        { name: "레이크 코스", type: "fairway", center: [37.7980, 127.6175] },
        { name: "밸리 코스", type: "fairway", center: [37.8005, 127.6200] },
      ],
    },
    {
      name: "제이드팰리스 골프클럽",
      name_en: "Jade Palace GC",
      lat: 37.8408, lng: 127.5521,
      address: "강원특별자치도 춘천시 남산면 서천리 산35",
      region: "강원", holes: 18, area_sqm: 720000,
      boundary: makeBoundary(37.8408, 127.5521, 0.004),
      zones: [
        { name: "가든 코스", type: "fairway", center: [37.8395, 127.5505] },
        { name: "포레스트 코스", type: "fairway", center: [37.8420, 127.5535] },
      ],
    },
    {
      name: "춘천 현대성우CC",
      name_en: "Chuncheon Hyundai Sungwoo CC",
      lat: 38.0297, lng: 127.8803,
      address: "강원특별자치도 춘천시 북산면 추곡약사골길 95",
      region: "강원", holes: 18, area_sqm: 800000,
      boundary: makeBoundary(38.0297, 127.8803, 0.004),
      zones: [
        { name: "프론트 나인", type: "fairway", center: [38.0285, 127.8790] },
        { name: "백 나인", type: "fairway", center: [38.0310, 127.8815] },
      ],
    },
    {
      name: "춘천 세종CC",
      name_en: "Chuncheon Sejong CC",
      lat: 37.9038, lng: 127.7868,
      address: "강원특별자치도 춘천시 동면 감정리",
      region: "강원", holes: 18, area_sqm: 690000,
      boundary: makeBoundary(37.9038, 127.7868, 0.004),
      zones: [
        { name: "프론트 나인", type: "fairway", center: [37.9025, 127.7855] },
        { name: "백 나인", type: "fairway", center: [37.9050, 127.7880] },
      ],
    },
    // ===== 기타 =====
    {
      name: "파인비치 골프링크스",
      name_en: "Pine Beach Golf Links",
      lat: 34.6980, lng: 126.2643,
      address: "전라남도 해남군 북평면 인지리 803",
      region: "전남", holes: 18, area_sqm: 850000,
      boundary: makeBoundary(34.6980, 126.2643, 0.004),
      zones: [
        { name: "씨사이드 코스", type: "fairway", center: [34.6970, 126.2630] },
        { name: "파인힐 코스", type: "fairway", center: [34.6990, 126.2660] },
      ],
    },
    {
      name: "오크밸리CC",
      name_en: "Oak Valley CC",
      lat: 37.4104, lng: 127.8195,
      address: "강원특별자치도 원주시 지정면 오크밸리2길 66",
      region: "강원", holes: 18, area_sqm: 750000,
      boundary: makeBoundary(37.4104, 127.8195, 0.004),
      zones: [
        { name: "프론트 나인", type: "fairway", center: [37.4090, 127.8180] },
        { name: "백 나인", type: "fairway", center: [37.4118, 127.8210] },
      ],
    },
  ];
}

function seedNDVIData(database) {
  const courses =
    database._type === "sqlite"
      ? database.prepare("SELECT id, name FROM golf_courses").all()
      : database._data.golf_courses.map((c) => ({ id: c.id, name: c.name }));

  // 각 골프장에 대해 1년치 NDVI 데이터 생성
  let totalRecords = 0;
  for (const course of courses) {
    const count = generateYearlyNDVI(course.id);
    totalRecords += count;
    console.log(`[DB] ${course.name || course.id}: ${count}건 NDVI 생성`);
  }
  console.log(`[DB] 전체 NDVI 시드 완료: ${courses.length}개 골프장, ${totalRecords}건 레코드`);

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
