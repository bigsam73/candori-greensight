/**
 * Candori GreenSight - Golf Course NDVI Monitoring Platform
 * Main Application JavaScript
 */

// ============ TOAST NOTIFICATION ============
function showToast(message, duration = 5000) {
  const existing = document.getElementById("toast-notification");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "toast-notification";
  toast.style.cssText = `
    position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:#1e2130;color:#e8eaf0;padding:12px 24px;border-radius:10px;
    border:1px solid #4ade80;box-shadow:0 8px 32px rgba(0,0,0,0.4);
    font-size:13px;z-index:9999;display:flex;align-items:center;gap:10px;
    animation:toastIn 0.3s ease;max-width:600px;
  `;
  toast.innerHTML = `
    <span class="material-icons-outlined" style="color:#4ade80;font-size:20px">check_circle</span>
    <span>${message}</span>
  `;
  document.body.appendChild(toast);

  // Add animation keyframes if not exists
  if (!document.getElementById("toast-style")) {
    const style = document.createElement("style");
    style.id = "toast-style";
    style.textContent = `
      @keyframes toastIn { from { opacity:0; transform:translateX(-50%) translateY(20px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
      @keyframes toastOut { from { opacity:1; } to { opacity:0; transform:translateX(-50%) translateY(20px); } }
    `;
    document.head.appendChild(style);
  }

  setTimeout(() => {
    toast.style.animation = "toastOut 0.3s ease forwards";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============ STATE ============
const state = {
  courses: [],
  selectedCourse: null,
  alerts: [],
  ndviData: {},
  satellites: [],
  dashboardMap: null,
  fullMap: null,
  charts: {},
};

// ============ API ============
const API = {
  async get(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API Error: ${res.status}`);
    return res.json();
  },
  async post(url, data) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`API Error: ${res.status}`);
    return res.json();
  },
  async put(url, data) {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
    });
    if (!res.ok) throw new Error(`API Error: ${res.status}`);
    return res.json();
  },
  async delete(url) {
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok) throw new Error(`API Error: ${res.status}`);
    return res.json();
  },
};

// ============ NDVI HELPERS ============
function getNDVIColor(ndvi) {
  if (ndvi == null) return "#555";
  if (ndvi < 0.15) return "#8b0000";
  if (ndvi < 0.25) return "#d32f2f";
  if (ndvi < 0.35) return "#ff9800";
  if (ndvi < 0.45) return "#cddc39";
  if (ndvi < 0.55) return "#8bc34a";
  if (ndvi < 0.65) return "#4caf50";
  if (ndvi < 0.75) return "#388e3c";
  return "#1b5e20";
}

function getNDVIStatus(ndvi) {
  if (ndvi == null) return { text: "데이터 없음", class: "muted" };
  if (ndvi < 0.2) return { text: "위험", class: "critical" };
  if (ndvi < 0.35) return { text: "나쁨", class: "poor" };
  if (ndvi < 0.5) return { text: "보통", class: "fair" };
  if (ndvi < 0.65) return { text: "양호", class: "moderate" };
  if (ndvi < 0.8) return { text: "좋음", class: "good" };
  return { text: "매우 건강", class: "excellent" };
}

function getNDVIHealthEmoji(ndvi) {
  if (ndvi == null) return "--";
  if (ndvi < 0.2) return "!!! ";
  if (ndvi < 0.35) return "!! ";
  if (ndvi < 0.5) return "! ";
  return "";
}

// ============ BOUNDARY PARSER (단일/다중 폴리곤 호환) ============
function parseBoundary(boundary) {
  if (!boundary || !Array.isArray(boundary) || boundary.length === 0) return [];
  // 다중 폴리곤: [{ name: "코스1", coords: [[lat,lng]...] }, ...]
  if (boundary[0] && boundary[0].coords) return boundary;
  // 단일 폴리곤: [[lat,lng], [lat,lng], ...]
  if (Array.isArray(boundary[0]) && typeof boundary[0][0] === "number") {
    return [{ name: "전체", coords: boundary }];
  }
  return [];
}

function getAllBoundaryCoords(boundary) {
  const polys = parseBoundary(boundary);
  const all = [];
  polys.forEach((p) => { if (p.coords) all.push(...p.coords); });
  return all;
}

// ============ MAP ADDRESS SEARCH (주소/장소 검색) ============

function initMapSearch() {
  const input = document.getElementById("mapSearchInput");
  const results = document.getElementById("mapSearchResults");
  if (!input || !results) return;

  let debounceTimer = null;

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (query.length < 2) {
      results.classList.remove("active");
      return;
    }
    debounceTimer = setTimeout(() => searchAddress(query), 400);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(debounceTimer);
      const query = input.value.trim();
      if (query.length >= 2) searchAddress(query);
    }
    if (e.key === "Escape") {
      results.classList.remove("active");
    }
  });

  // 외부 클릭 시 결과 닫기
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".map-search-box")) {
      results.classList.remove("active");
    }
  });
}

async function searchAddress(query) {
  const results = document.getElementById("mapSearchResults");
  results.innerHTML = '<div class="map-search-loading"><div class="spinner" style="width:14px;height:14px;display:inline-block;margin-right:6px;vertical-align:middle"></div>검색 중...</div>';
  results.classList.add("active");

  try {
    // Nominatim API (OpenStreetMap, 무료, API 키 불필요)
    const encoded = encodeURIComponent(query);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&countrycodes=kr&limit=8&addressdetails=1&accept-language=ko`,
      { headers: { "User-Agent": "CandoriGreenSight/1.0" } }
    );
    const data = await response.json();

    if (data.length === 0) {
      results.innerHTML = `
        <div class="map-search-loading">
          <span class="material-icons-outlined" style="font-size:20px;display:block;margin-bottom:4px">search_off</span>
          "${query}" 검색 결과 없음
        </div>
      `;
      return;
    }

    results.innerHTML = data.map((item) => {
      const name = item.display_name.split(",")[0];
      const addr = item.display_name.split(",").slice(1, 4).join(",").trim();
      const icon = getPlaceIcon(item.type, item.class);
      return `
        <div class="map-search-result-item" data-lat="${item.lat}" data-lng="${item.lon}" data-name="${name}" data-bbox="${item.boundingbox?.join(",")}">
          <span class="material-icons-outlined">${icon}</span>
          <div>
            <div class="map-search-result-name">${name}</div>
            <div class="map-search-result-addr">${addr}</div>
          </div>
        </div>
      `;
    }).join("");

    // 결과 클릭 이벤트
    results.querySelectorAll(".map-search-result-item").forEach((item) => {
      item.addEventListener("click", () => {
        const lat = parseFloat(item.dataset.lat);
        const lng = parseFloat(item.dataset.lng);
        const name = item.dataset.name;
        const bboxStr = item.dataset.bbox;

        // 지도 이동
        const targetMap = state.fullMap || state.dashboardMap;
        if (targetMap) {
          if (bboxStr) {
            const [s, n, w, e] = bboxStr.split(",").map(Number);
            targetMap.fitBounds([[s, w], [n, e]], { maxZoom: 17, padding: [20, 20] });
          } else {
            targetMap.setView([lat, lng], 16);
          }

          // 검색 마커 추가
          if (targetMap._searchMarker) targetMap.removeLayer(targetMap._searchMarker);
          targetMap._searchMarker = L.marker([lat, lng], {
            icon: L.divIcon({
              className: "",
              html: `<div style="position:relative">
                <div style="width:20px;height:20px;border-radius:50%;background:#f87171;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.5)"></div>
                <div style="position:absolute;top:24px;left:50%;transform:translateX(-50%);white-space:nowrap;background:rgba(30,33,48,0.9);padding:3px 8px;border-radius:4px;font-size:11px;color:#fff;border:1px solid var(--border-color)">${name}</div>
              </div>`,
              iconSize: [20, 20],
              iconAnchor: [10, 10],
            }),
          }).addTo(targetMap);

          // 5초 후 마커 제거
          setTimeout(() => {
            if (targetMap._searchMarker) {
              targetMap.removeLayer(targetMap._searchMarker);
              targetMap._searchMarker = null;
            }
          }, 8000);
        }

        // 검색창 업데이트
        document.getElementById("mapSearchInput").value = name;
        results.classList.remove("active");
      });
    });
  } catch (err) {
    results.innerHTML = `<div class="map-search-loading" style="color:var(--accent-red)">검색 실패: ${err.message}</div>`;
  }
}

function getPlaceIcon(type, cls) {
  if (cls === "leisure" || type === "golf_course") return "sports_golf";
  if (cls === "building" || type === "house") return "home";
  if (cls === "highway" || type === "road") return "route";
  if (type === "city" || type === "town" || type === "village") return "location_city";
  if (type === "administrative") return "flag";
  if (cls === "amenity") return "store";
  if (cls === "natural") return "park";
  return "place";
}

// ============ INITIALIZATION ============
document.addEventListener("DOMContentLoaded", () => {
  initNavigation();
  initDate();
  initMaps();
  loadData();
  initEventListeners();
});

function initDate() {
  const now = new Date();
  document.getElementById("currentDate").textContent = now.toLocaleDateString(
    "ko-KR",
    { year: "numeric", month: "long", day: "numeric", weekday: "short" }
  );
  const dateInput = document.getElementById("mapDate");
  if (dateInput) {
    dateInput.value = now.toISOString().split("T")[0];
  }
}

// ============ NAVIGATION ============
function initNavigation() {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const view = item.dataset.view;
      switchView(view);
    });
  });

  // Mobile menu toggle
  document.getElementById("menuToggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
  });
}

function switchView(viewId) {
  // Update nav
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  document.querySelector(`.nav-item[data-view="${viewId}"]`)?.classList.add("active");

  // Update views
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${viewId}`)?.classList.add("active");

  // Update title
  const titles = {
    dashboard: "대시보드",
    map: "위성지도",
    courses: "골프장 관리",
    analysis: "NDVI 분석",
    compare: "비교 분석",
    alerts: "알림 센터",
    satellites: "위성 데이터 소스",
    report: "리포트",
  };
  document.getElementById("pageTitle").textContent = titles[viewId] || viewId;

  // Initialize view-specific content
  if (viewId === "map") initFullMap();
  if (viewId === "alerts") loadAlerts();
  if (viewId === "analysis") initAnalysisView();
  if (viewId === "compare") initCompareView();
  if (viewId === "satellites") loadSatelliteCatalog();

  // Close mobile sidebar
  document.getElementById("sidebar").classList.remove("open");
}

// ============ DATA LOADING ============
async function loadData() {
  try {
    const [courses, alertSummary, satellites] = await Promise.all([
      API.get("/api/golf-courses"),
      API.get("/api/alerts/summary"),
      API.get("/api/ndvi/satellites"),
    ]);

    state.courses = courses;
    state.satellites = satellites;
    updateDashboard(courses, alertSummary);
    populateCourseSelectors();
    populateSatelliteSelectors(satellites);
    renderCourseList();
    renderCoursesGrid();
    updateMapMarkers(state.dashboardMap, courses);
    updateSidebarSatInfo(satellites);
  } catch (err) {
    console.error("데이터 로드 실패:", err);
  }
}

function updateDashboard(courses, alertSummary) {
  document.getElementById("totalCourses").textContent = courses.length;

  const avgNDVI =
    courses.reduce((sum, c) => sum + (c.latest_ndvi || 0), 0) / courses.length;
  document.getElementById("avgNDVI").textContent = avgNDVI.toFixed(3);
  document.getElementById("avgNDVI").style.color = getNDVIColor(avgNDVI);

  document.getElementById("alertCount").textContent = alertSummary.unread || 0;
  document.getElementById("alertBadge").textContent = alertSummary.unread || 0;

  if (alertSummary.unread > 0) {
    document.getElementById("notifDot").classList.add("active");
    document.getElementById("alertBadge").style.display = "";
  } else {
    document.getElementById("notifDot").classList.remove("active");
    document.getElementById("alertBadge").style.display = "none";
  }

  const latestDate = courses.reduce(
    (latest, c) => (c.latest_date > latest ? c.latest_date : latest),
    ""
  );
  document.getElementById("lastUpdate").textContent = latestDate || "-";

  // Load trend chart
  loadTrendChart();
  loadRegionChart(courses);
}

function populateCourseSelectors() {
  const selectors = [
    "trendCourseSelect",
    "analysisCourseSelect",
    "compareCourses",
    "reportCourse",
  ];

  selectors.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;

    // Keep the first option
    const firstOpt = el.options[0];
    el.innerHTML = "";
    if (firstOpt) el.appendChild(firstOpt);

    state.courses.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      el.appendChild(opt);
    });
  });
}

// ============ COURSE LIST ============
function renderCourseList() {
  const container = document.getElementById("courseList");
  const sorted = [...state.courses].sort(
    (a, b) => (b.latest_ndvi || 0) - (a.latest_ndvi || 0)
  );

  container.innerHTML = sorted
    .map((c, i) => {
      const ndvi = c.latest_ndvi;
      const color = getNDVIColor(ndvi);
      const status = getNDVIStatus(ndvi);
      const pct = ndvi ? Math.round(ndvi * 100) : 0;

      return `
      <div class="course-item" data-course-id="${c.id}">
        <div class="ndvi-indicator" style="background:${color}22;color:${color}">
          ${ndvi ? ndvi.toFixed(2) : "--"}
        </div>
        <div class="course-item-info">
          <div class="course-item-name">${c.name}</div>
          <div class="course-item-meta">${c.region || ""} | ${c.latest_satellite || "-"} | ${c.latest_date || "-"}</div>
        </div>
        <div class="ndvi-bar">
          <div class="ndvi-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>
    `;
    })
    .join("");

  // Click events
  container.querySelectorAll(".course-item").forEach((item) => {
    item.addEventListener("click", () => {
      const courseId = item.dataset.courseId;
      state.selectedCourse = state.courses.find(
        (c) => c.id === Number(courseId)
      );
      switchView("analysis");
      document.getElementById("analysisCourseSelect").value = courseId;
      loadAnalysis(courseId);
    });
  });

  // Search
  document.getElementById("courseSearch").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    container.querySelectorAll(".course-item").forEach((item) => {
      const name = item.querySelector(".course-item-name").textContent.toLowerCase();
      item.style.display = name.includes(q) ? "" : "none";
    });
  });
}

// ============ COURSES GRID ============
function renderCoursesGrid() {
  const grid = document.getElementById("coursesGrid");
  grid.innerHTML = state.courses
    .map((c) => {
      const ndvi = c.latest_ndvi;
      const color = getNDVIColor(ndvi);
      const status = getNDVIStatus(ndvi);

      return `
      <div class="card course-card" data-course-id="${c.id}">
        <div class="course-card-header">
          <div class="course-card-name">${c.name}</div>
          <span class="course-card-region">${c.region || "-"}</span>
        </div>
        <div style="font-size:12px;color:var(--text-muted)">${c.address || ""}</div>
        <div class="course-card-ndvi">
          <div class="ndvi-big" style="color:${color}">${ndvi ? ndvi.toFixed(3) : "--"}</div>
          <div class="ndvi-label-group">
            <div class="ndvi-label">NDVI 지수</div>
            <div class="ndvi-status" style="color:${color}">${status.text}</div>
          </div>
        </div>
        <div class="course-card-info">
          <div class="info-item"><span>홀:</span> ${c.holes || 18}H</div>
          <div class="info-item"><span>위성:</span> ${c.latest_satellite || "-"}</div>
          <div class="info-item"><span>위치:</span> ${c.lat?.toFixed(4)}, ${c.lng?.toFixed(4)}</div>
          <div class="info-item"><span>갱신:</span> ${c.latest_date || "-"}</div>
        </div>
        <div style="display:flex;gap:6px;margin-top:10px">
          <button class="btn btn-sm btn-secondary edit-location-btn" data-id="${c.id}" style="flex:1;justify-content:center" onclick="event.stopPropagation(); openEditLocationModal(${c.id})">
            <span class="material-icons-outlined">edit_location_alt</span>
            위치/영역 수정
          </button>
          <button class="btn btn-sm" style="justify-content:center;background:rgba(248,113,113,0.1);color:#f87171;border:1px solid rgba(248,113,113,0.2)" onclick="event.stopPropagation(); deleteCourse(${c.id}, '${c.name.replace(/'/g, "\\'")}')">
            <span class="material-icons-outlined">delete</span>
          </button>
        </div>
      </div>
    `;
    })
    .join("");

  grid.querySelectorAll(".course-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return; // 버튼 클릭은 무시
      const id = card.dataset.courseId;
      state.selectedCourse = state.courses.find((c) => c.id === Number(id));
      switchView("analysis");
      document.getElementById("analysisCourseSelect").value = id;
      loadAnalysis(id);
    });
  });
}

// ============ MAPS ============
function initMaps() {
  // Dashboard map
  state.dashboardMap = L.map("dashboardMap", {
    zoomControl: true,
    attributionControl: false,
  }).setView([36.5, 127.8], 7);

  addTileLayers(state.dashboardMap);
}

function addTileLayers(map, type = "dark") {
  // Dark CartoDB tiles
  const dark = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    { maxZoom: 19, attribution: "CartoDB" }
  );

  // ESRI Satellite (World Imagery)
  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 19, attribution: "ESRI World Imagery" }
  );

  // ESRI Clarity (Maxar 0.3~0.5m 초고해상도 - 무료 최고)
  const esriClarity = L.tileLayer(
    "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 20, attribution: "ESRI Clarity (Maxar)" }
  );

  // ESRI 라벨 오버레이 (위성 위에 지명 표시용)
  const esriLabels = L.tileLayer(
    "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    { maxZoom: 20, attribution: "", pane: "overlayPane" }
  );

  // OpenStreetMap
  const osm = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 19, attribution: "OpenStreetMap" }
  );

  // Google Maps - 일반
  const googleRoad = L.tileLayer(
    "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
    { maxZoom: 21, attribution: "Google Maps" }
  );

  // Google Maps - 위성
  const googleSat = L.tileLayer(
    "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    { maxZoom: 21, attribution: "Google Satellite" }
  );

  // Google Maps - 하이브리드 (위성 + 라벨)
  const googleHybrid = L.tileLayer(
    "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    { maxZoom: 21, attribution: "Google Hybrid" }
  );

  // Google Maps - 지형도
  const googleTerrain = L.tileLayer(
    "https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}",
    { maxZoom: 21, attribution: "Google Terrain" }
  );

  dark.addTo(map);
  map._layers_custom = { dark, satellite, esriClarity, esriLabels, osm, googleRoad, googleSat, googleHybrid, googleTerrain };

  // Planet Basemaps를 비동기로 로드 (API Key가 있을 때만)
  loadPlanetBasemapLayer(map);
}

async function loadPlanetBasemapLayer(map) {
  try {
    const config = await API.get("/api/planet/basemap-tile-url");
    if (config.ok && config.tileUrl) {
      const planetLayer = L.tileLayer(config.tileUrl, {
        maxZoom: 20,
        attribution: "Planet 4.77m",
      });
      map._layers_custom.planet = planetLayer;
      map._planetTileUrlTemplate = config.tileUrl.replace(config.mosaicName, "{mosaic}");

      // Planet Basemaps 모자이크 목록 로드
      const basemaps = await API.get("/api/planet/basemaps");
      if (basemaps.ok && basemaps.mosaics?.length > 0) {
        state._planetMosaics = basemaps.mosaics;
        populatePlanetMosaicSelectors(basemaps.mosaics);
      }
    }
  } catch (e) {
    // Planet API Key 없으면 무시
  }
}

function populatePlanetMosaicSelectors(mosaics) {
  // 위성지도 뷰와 대시보드의 배경지도 드롭다운에 Planet 옵션 추가
  ["fullMapLayer", "mapLayerSelect"].forEach((selId) => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    // 이미 Planet 옵션이 있으면 스킵
    if (sel.querySelector('option[value^="planet-"]')) return;

    const group = document.createElement("optgroup");
    group.label = `Planet Basemaps 4.77m (${Math.min(12, mosaics.length)}개월)`;
    // 최근 12개월
    mosaics.slice(0, 12).forEach((m) => {
      const opt = document.createElement("option");
      opt.value = "planet-" + m.name;
      const label = m.name.replace("global_monthly_", "").replace("_mosaic", "").replace("_", "-");
      opt.textContent = `Planet ${label} (4.77m)`;
      group.appendChild(opt);
    });
    sel.appendChild(group);
  });
}

function switchMapLayer(map, layerType) {
  const layers = map._layers_custom;
  if (!layers) return;

  Object.values(layers).forEach((l) => map.removeLayer(l));

  // Planet Basemaps (dynamic mosaic)
  if (layerType.startsWith("planet-")) {
    const mosaicName = layerType.replace("planet-", "");
    if (map._planetTileUrlTemplate) {
      const url = map._planetTileUrlTemplate.replace("{mosaic}", mosaicName);
      const planetLayer = L.tileLayer(url, { maxZoom: 20, attribution: "Planet " + mosaicName });
      // 이전 planet 레이어 교체
      if (layers._activePlanet) map.removeLayer(layers._activePlanet);
      layers._activePlanet = planetLayer;
      planetLayer.addTo(map);
    } else if (layers.planet) {
      layers.planet.addTo(map);
    }
    return;
  }

  // Remove active planet layer if switching away
  if (layers._activePlanet) {
    map.removeLayer(layers._activePlanet);
    layers._activePlanet = null;
  }

  // Remove labels overlay if present
  if (layers.esriLabels) map.removeLayer(layers.esriLabels);

  switch (layerType) {
    case "esri-clarity":
      layers.esriClarity.addTo(map);
      layers.esriLabels.addTo(map);
      break;
    case "esri-clarity-nolabel":
      layers.esriClarity.addTo(map);
      break;
    case "satellite":
      layers.satellite.addTo(map);
      break;
    case "osm":
      layers.osm.addTo(map);
      break;
    case "google-road":
      layers.googleRoad.addTo(map);
      break;
    case "google-sat":
      layers.googleSat.addTo(map);
      break;
    case "google-hybrid":
      layers.googleHybrid.addTo(map);
      break;
    case "google-terrain":
      layers.googleTerrain.addTo(map);
      break;
    default:
      layers.dark.addTo(map);
  }
}

function updateMapMarkers(map, courses) {
  if (!map) return;

  // Clear existing markers
  if (map._courseMarkers) {
    map._courseMarkers.forEach((m) => map.removeLayer(m));
  }
  map._courseMarkers = [];

  courses.forEach((c) => {
    const ndvi = c.latest_ndvi;
    const color = getNDVIColor(ndvi);
    const status = getNDVIStatus(ndvi);

    // Custom circle marker
    const marker = L.circleMarker([c.lat, c.lng], {
      radius: 12,
      fillColor: color,
      fillOpacity: 0.8,
      color: "#fff",
      weight: 2,
      opacity: 0.9,
    }).addTo(map);

    // Popup
    marker.bindPopup(`
      <div class="popup-title">${c.name}</div>
      <div class="popup-ndvi" style="color:${color}">${ndvi ? ndvi.toFixed(3) : "--"}</div>
      <div style="color:${color};font-size:12px;font-weight:500">${status.text}</div>
      <div class="popup-meta">${c.region || ""} | ${c.holes || 18}H | ${c.latest_satellite || ""}</div>
      <div class="popup-meta">최근 갱신: ${c.latest_date || "-"}</div>
      <div style="display:flex;gap:4px;margin-top:6px">
        <span class="popup-btn" onclick="selectCourseOnMap(${c.id})">가용날짜 보기</span>
        <span class="popup-btn" style="background:var(--accent-blue)" onclick="viewCourseDetail(${c.id})">상세분석</span>
      </div>
    `);

    // Add boundary polygon(s) - 다중 코스 지원
    const boundaries = parseBoundary(c.boundary);
    boundaries.forEach((poly, pi) => {
      if (poly.coords && poly.coords.length >= 3) {
        const pColor = pi === 0 ? color : POLY_COLORS[pi % POLY_COLORS.length];
        const polygon = L.polygon(poly.coords, {
          color: pColor, weight: 2, fillColor: pColor, fillOpacity: 0.12, dashArray: "5,5",
        }).addTo(map);
        if (poly.name && boundaries.length > 1) {
          polygon.bindTooltip(poly.name, { permanent: false, direction: "center", className: "poly-label" });
        }
        map._courseMarkers.push(polygon);
      }
    });

    map._courseMarkers.push(marker);
  });
}

function initFullMap() {
  if (state.fullMap) {
    state.fullMap.invalidateSize();
    return;
  }

  state.fullMap = L.map("fullMap", {
    zoomControl: true,
    attributionControl: false,
  }).setView([36.5, 127.8], 8);

  addTileLayers(state.fullMap);
  updateMapMarkers(state.fullMap, state.courses);

  // Populate the course selector in toolbar
  const mapCourseSelect = document.getElementById("mapCourseSelect");
  if (mapCourseSelect && mapCourseSelect.options.length <= 1) {
    state.courses.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.region || ""})`;
      mapCourseSelect.appendChild(opt);
    });
  }

  // Layer switcher
  document.getElementById("fullMapLayer").addEventListener("change", (e) => {
    switchMapLayer(state.fullMap, e.target.value);
  });

  // Address search
  initMapSearch();

  // Course selector in toolbar → load available dates
  mapCourseSelect.addEventListener("change", (e) => {
    const courseId = e.target.value;
    if (!courseId) return;
    state.selectedCourse = state.courses.find((c) => c.id === Number(courseId));
    // Fly to course
    if (state.selectedCourse) {
      state.fullMap.flyTo([state.selectedCourse.lat, state.selectedCourse.lng], 14, { duration: 1.2 });
    }
    loadAvailableDates(courseId);
  });

  // Satellite source filter → reload dates
  document.getElementById("satelliteSourceSelect").addEventListener("change", () => {
    if (state.selectedCourse) {
      loadAvailableDates(state.selectedCourse.id);
    }
  });

  // Click on map marker → select course + load dates
  state.fullMap.on("popupopen", (e) => {
    const content = e.popup.getContent();
    const match = content.match(/viewCourseDetail\((\d+)\)/);
    if (match) {
      const courseId = Number(match[1]);
      state.selectedCourse = state.courses.find((c) => c.id === courseId);
      // Sync the toolbar dropdown
      mapCourseSelect.value = courseId;
      loadAvailableDates(courseId);
    }
  });
}

// ── Available dates panel ─────────────────────────────────────────

async function loadAvailableDates(courseId) {
  const title = document.getElementById("mapInfoTitle");
  const content = document.getElementById("mapInfoContent");
  const course = state.courses.find((c) => c.id === Number(courseId));
  if (!course) return;

  title.textContent = course.name;
  content.innerHTML = '<div class="loading"><div class="spinner"></div> 가용 날짜 조회 중...</div>';

  const satFilter = document.getElementById("satelliteSourceSelect").value || undefined;

  try {
    let url = `/api/ndvi/available-dates/${courseId}?days=90`;
    if (satFilter) url += `&satellite=${encodeURIComponent(satFilter)}`;

    const dates = await API.get(url);

    if (dates.length === 0) {
      content.innerHTML = `
        <div style="text-align:center;padding:16px 0;color:var(--text-muted)">
          <span class="material-icons-outlined" style="font-size:32px;display:block;margin-bottom:6px">event_busy</span>
          <div style="font-size:12px">최근 90일간 데이터가 없습니다</div>
          <div style="font-size:11px;margin-top:4px">위성 소스 필터를 변경해 보세요</div>
        </div>
      `;
      return;
    }

    // Collect unique satellites for filter buttons
    const satTypes = [...new Set(dates.map((d) => d.satellite))];
    state._mapAvailDates = dates;
    state._mapAvailSatTypes = satTypes;
    state._mapAvailFilter = "all";

    renderAvailableDatesPanel(course, dates, satTypes, "all");
  } catch (err) {
    content.innerHTML = '<div style="color:var(--accent-red);font-size:12px">데이터 조회 실패</div>';
    console.error(err);
  }
}

function renderAvailableDatesPanel(course, dates, satTypes, activeFilter) {
  const content = document.getElementById("mapInfoContent");

  const filtered = activeFilter === "all"
    ? dates
    : dates.filter((d) => d.satellite === activeFilter);

  // Summary stats
  const latest = filtered[0];
  const avgNdvi = filtered.reduce((s, d) => s + d.ndvi_mean, 0) / filtered.length;

  content.innerHTML = `
    <!-- Summary -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:12px">
      <div style="padding:6px;background:var(--bg-primary);border-radius:6px;text-align:center">
        <div style="font-size:16px;font-weight:700;color:${getNDVIColor(latest?.ndvi_mean)}">${latest?.ndvi_mean?.toFixed(3) || "--"}</div>
        <div style="font-size:9px;color:var(--text-muted)">최신 NDVI</div>
      </div>
      <div style="padding:6px;background:var(--bg-primary);border-radius:6px;text-align:center">
        <div style="font-size:16px;font-weight:700;color:${getNDVIColor(avgNdvi)}">${avgNdvi.toFixed(3)}</div>
        <div style="font-size:9px;color:var(--text-muted)">평균</div>
      </div>
      <div style="padding:6px;background:var(--bg-primary);border-radius:6px;text-align:center">
        <div style="font-size:16px;font-weight:700;color:var(--accent-blue)">${filtered.length}</div>
        <div style="font-size:9px;color:var(--text-muted)">관측 횟수</div>
      </div>
    </div>

    <!-- Available dates section -->
    <div class="avail-dates-section">
      <div class="avail-dates-header">
        <h5>관측 가능 날짜 (최근 90일)</h5>
        <span class="avail-dates-count">${filtered.length}건</span>
      </div>

      <!-- Satellite filter buttons -->
      <div class="avail-dates-filter">
        <button class="avail-filter-btn ${activeFilter === "all" ? "active" : ""}" data-filter="all">전체</button>
        ${satTypes.map((s) => `
          <button class="avail-filter-btn ${activeFilter === s ? "active" : ""}" data-filter="${s}">${s}</button>
        `).join("")}
      </div>

      <!-- Date list -->
      <div class="avail-dates-list" style="max-height:320px;overflow-y:auto">
        ${filtered.map((d, i) => {
          const dow = new Date(d.date).toLocaleDateString("ko-KR", { weekday: "short" });
          const color = getNDVIColor(d.ndvi_mean);
          const cloudIcon = d.cloud_cover > 20 ? "cloud" : d.cloud_cover > 5 ? "cloud_queue" : "wb_sunny";
          return `
            <div class="avail-date-item" data-idx="${i}" data-date="${d.date}" data-satellite="${d.satellite}">
              <div class="avail-date-day">${d.date}<br><span style="font-size:10px;color:var(--text-muted)">${dow}</span></div>
              <div class="avail-date-sat">${d.satellite}</div>
              <span class="material-icons-outlined" style="font-size:14px;color:var(--text-muted)" title="구름량 ${d.cloud_cover?.toFixed(0)}%">${cloudIcon}</span>
              <div class="avail-date-cloud">${d.cloud_cover?.toFixed(0)}%</div>
              <div class="avail-date-ndvi" style="color:${color}">${d.ndvi_mean?.toFixed(3)}</div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;

  // Bind filter button clicks
  content.querySelectorAll(".avail-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const f = btn.dataset.filter;
      state._mapAvailFilter = f;
      renderAvailableDatesPanel(course, dates, satTypes, f);
    });
  });

  // Bind date item clicks → show detail
  content.querySelectorAll(".avail-date-item").forEach((item) => {
    item.addEventListener("click", () => {
      // Highlight selected
      content.querySelectorAll(".avail-date-item").forEach((el) => el.classList.remove("selected"));
      item.classList.add("selected");

      const date = item.dataset.date;
      const satellite = item.dataset.satellite;
      const idx = Number(item.dataset.idx);
      const record = filtered[idx];

      showSelectedDateDetail(course, record);
    });
  });
}

function showSelectedDateDetail(course, record) {
  // Remove previous detail
  const existing = document.getElementById("selectedDateDetail");
  if (existing) existing.remove();

  const container = document.querySelector(".avail-dates-section");
  if (!container) return;

  const color = getNDVIColor(record.ndvi_mean);
  const status = getNDVIStatus(record.ndvi_mean);

  const detail = document.createElement("div");
  detail.id = "selectedDateDetail";
  detail.className = "selected-date-detail";
  detail.innerHTML = `
    <h5>${record.date} 관측 데이터</h5>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <div style="font-size:28px;font-weight:700;color:${color}">${record.ndvi_mean?.toFixed(3)}</div>
      <div>
        <div style="font-size:12px;color:${color};font-weight:600">${status.text}</div>
        <div style="font-size:10px;color:var(--text-muted)">${record.satellite}</div>
      </div>
    </div>
    <div class="detail-grid">
      <div class="detail-label">NDVI 최소</div>
      <div class="detail-value">${record.ndvi_min?.toFixed(3) || "-"}</div>
      <div class="detail-label">NDVI 최대</div>
      <div class="detail-value">${record.ndvi_max?.toFixed(3) || "-"}</div>
      <div class="detail-label">구름량</div>
      <div class="detail-value">${record.cloud_cover?.toFixed(1) || 0}%</div>
      <div class="detail-label">위성 소스</div>
      <div class="detail-value">${record.satellite}</div>
    </div>
    <!-- 식생 지수 선택 -->
    <div style="margin-top:10px">
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">식생 지수 선택 → 지도에 표시</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
        <button class="vi-btn" style="--vi-color:#4ade80" onclick="showIndexOverlay('${course.id}','${record.date}','ndvi',${record.ndvi_mean})">
          <span class="vi-dot" style="background:#4ade80"></span>NDVI
        </button>
        <button class="vi-btn" style="--vi-color:#fb923c" onclick="showIndexOverlay('${course.id}','${record.date}','ndre',${record.ndvi_mean})">
          <span class="vi-dot" style="background:#fb923c"></span>NDRE
        </button>
        <button class="vi-btn" style="--vi-color:#a78bfa" onclick="showIndexOverlay('${course.id}','${record.date}','gndvi',${record.ndvi_mean})">
          <span class="vi-dot" style="background:#a78bfa"></span>GNDVI
        </button>
        <button class="vi-btn" style="--vi-color:#2dd4bf" onclick="showIndexOverlay('${course.id}','${record.date}','savi',${record.ndvi_mean})">
          <span class="vi-dot" style="background:#2dd4bf"></span>SAVI
        </button>
        <button class="vi-btn" style="--vi-color:#60a5fa" onclick="showIndexOverlay('${course.id}','${record.date}','evi',${record.ndvi_mean})">
          <span class="vi-dot" style="background:#60a5fa"></span>EVI
        </button>
        <button class="vi-btn" style="--vi-color:#f87171" onclick="showIndexOverlay('${course.id}','${record.date}','msavi2',${record.ndvi_mean})">
          <span class="vi-dot" style="background:#f87171"></span>MSAVI2
        </button>
        <button class="vi-btn" style="--vi-color:#38bdf8" onclick="showIndexOverlay('${course.id}','${record.date}','ndmi',${record.ndvi_mean})">
          <span class="vi-dot" style="background:#38bdf8"></span>NDMI
        </button>
        <button class="vi-btn" style="--vi-color:#4ade80" onclick="showIndexOverlay('${course.id}','${record.date}','cire',${record.ndvi_mean})">
          <span class="vi-dot" style="background:#4ade80"></span>CIre
        </button>
        <button class="vi-btn" style="--vi-color:#86efac" onclick="showIndexOverlay('${course.id}','${record.date}','gli',${record.ndvi_mean})">
          <span class="vi-dot" style="background:#86efac"></span>GLI
        </button>
        <button class="vi-btn" style="--vi-color:#e8eaf0" onclick="showSatelliteImageOverlay('${course.id}','${record.date}','${record.satellite}')">
          <span class="vi-dot" style="background:#e8eaf0"></span>위성영상
        </button>
      </div>
    </div>
    <!-- Planet / 환경 데이터 -->
    <div style="display:flex;gap:4px;margin-top:6px">
      <button class="vi-btn" style="flex:1;--vi-color:#fb923c" onclick="requestPlanetImage('${course.id}','${record.date}','ndvi')">Planet NDVI</button>
      <button class="vi-btn" style="flex:1;--vi-color:#60a5fa" onclick="requestPlanetImage('${course.id}','${record.date}','rgb')">Planet RGB</button>
    </div>
    <div id="overlayStatus" style="margin-top:6px;font-size:10px;color:var(--text-muted)"></div>
  `;

  container.appendChild(detail);
  detail.scrollIntoView({ behavior: "smooth", block: "nearest" });

  // Auto-show NDVI overlay on date select
  showNDVIOverlay(course.id, record.date, record.satellite, record.ndvi_mean);
}

// ── Map Overlay: 식생 지수 히트맵 (범용) ──────────────────────────

// 식생 지수 메타정보 (프론트용)
const VI_META = {
  ndvi:   { name: "NDVI",   full: "Normalized Difference Vegetation Index", color: "#4ade80", unit: "", range: [0, 1],    good: 0.6, desc: "전체 식생 건강도" },
  ndre:   { name: "NDRE",   full: "Normalized Difference Red Edge Index",   color: "#fb923c", unit: "", range: [0, 0.8],  good: 0.4, desc: "초기 스트레스 감지 (NDVI보다 2~3주 빠름)" },
  gndvi:  { name: "GNDVI",  full: "Green NDVI",                            color: "#a78bfa", unit: "", range: [0, 0.8],  good: 0.5, desc: "엽록소 농도 / 질소 결핍" },
  savi:   { name: "SAVI",   full: "Soil Adjusted Vegetation Index",        color: "#2dd4bf", unit: "", range: [0, 0.7],  good: 0.35, desc: "토양 보정 (벙커/카트도로 주변)" },
  evi:    { name: "EVI",    full: "Enhanced Vegetation Index",             color: "#60a5fa", unit: "", range: [-0.2, 1], good: 0.3, desc: "고밀도 식생 정밀 측정" },
  msavi2: { name: "MSAVI2", full: "Modified Soil Adjusted VI",             color: "#f87171", unit: "", range: [0, 1],    good: 0.35, desc: "벙커 인접 그린 가장자리" },
  ndmi:   { name: "NDMI",   full: "Normalized Difference Moisture Index",  color: "#38bdf8", unit: "", range: [-0.3, 0.5], good: 0.1, desc: "잔디 수분 스트레스 / 관수 판단" },
  cire:   { name: "CIre",   full: "Chlorophyll Index Red Edge",            color: "#4ade80", unit: "", range: [0, 5],    good: 1.5, desc: "엽록소 함량 / 시비 효과" },
  gli:    { name: "GLI",    full: "Green Leaf Index",                      color: "#86efac", unit: "", range: [-0.3, 0.5], good: 0.1, desc: "잔디 녹색도 (RGB 기반)" },
};

window.showIndexOverlay = function (courseId, date, indexId, ndviMean) {
  const meta = VI_META[indexId] || VI_META.ndvi;
  // NDVI는 기존 함수 호출
  if (indexId === "ndvi") {
    return showNDVIOverlay(courseId, date, "", ndviMean);
  }

  if (!state.fullMap) return;
  const course = state.courses.find((c) => c.id === Number(courseId));
  if (!course) return;

  clearMapOverlays();

  const boundary = course.boundary || [];
  const fakeRecord = { ndvi_mean: ndviMean, date };
  const cells = generateNDVIGrid(course, fakeRecord);

  state._mapOverlayLayer = L.layerGroup();

  // 지수별 시뮬레이션 변환
  cells.forEach((cell) => {
    let value = cell.ndvi;
    // 지수별 값 범위 변환 (시뮬레이션)
    switch (indexId) {
      case "ndre":   value = value * 0.7; break;
      case "gndvi":  value = value * 0.85; break;
      case "savi":   value = value * 0.65; break;
      case "evi":    value = value * 0.8 - 0.05; break;
      case "msavi2": value = value * 0.7; break;
      case "ndmi":   value = value * 0.6 - 0.1; break;
      case "cire":   value = value * 3.5; break;
      case "gli":    value = value * 0.5 - 0.1; break;
    }

    const norm = (value - meta.range[0]) / (meta.range[1] - meta.range[0]);
    const clamp = Math.max(0, Math.min(1, norm));
    const color = getIndexColor(clamp, meta.color);

    const rect = L.rectangle(cell.bounds, {
      color: "transparent", weight: 0, fillColor: color, fillOpacity: 0.6,
    });
    rect.bindTooltip(
      `<b>${meta.name}: ${value.toFixed(3)}</b><br>${getIndexStatus(value, meta)}<br>${date}`,
      { sticky: true, className: "ndvi-tooltip" }
    );
    state._mapOverlayLayer.addLayer(rect);
  });

  // Boundary
  const boundaries = parseBoundary(boundary);
  boundaries.forEach((p) => {
    if (p.coords && p.coords.length >= 3) {
      L.polygon(p.coords, {
        color: "#fff", weight: 2.5, fillColor: "transparent", fillOpacity: 0, dashArray: "8,4",
      }).addTo(state._mapOverlayLayer);
    }
  });

  // Legend
  const legend = L.control({ position: "bottomleft" });
  legend.onAdd = function () {
    const div = L.DomUtil.create("div", "ndvi-map-legend");
    div.innerHTML = `
      <div style="background:rgba(30,33,48,0.92);padding:10px 12px;border-radius:8px;border:1px solid var(--border-color);font-size:10px;color:#e8eaf0;min-width:180px">
        <div style="font-weight:700;font-size:12px;margin-bottom:2px;color:${meta.color}">${meta.name}</div>
        <div style="font-size:9px;color:#9ba1b7;margin-bottom:6px">${meta.full}</div>
        <div style="display:flex;gap:3px;align-items:center;margin-bottom:4px">
          <span>${meta.range[0]}</span>
          <div style="flex:1;height:10px;border-radius:5px;background:linear-gradient(to right,#8b0000,#d32f2f,#ff9800,#cddc39,#8bc34a,#4caf50,#388e3c,#1b5e20)"></div>
          <span>${meta.range[1]}</span>
        </div>
        <div style="color:#9ba1b7">${meta.desc}</div>
        <div style="margin-top:4px;color:#9ba1b7">기준: ${meta.good}+ 양호 | ${date}</div>
      </div>
    `;
    return div;
  };
  legend.addTo(state.fullMap);
  state._mapLegendControl = legend;

  state._mapOverlayLayer.addTo(state.fullMap);

  // Zoom
  const allCoords = getAllBoundaryCoords(boundary);
  if (allCoords.length >= 3) {
    state.fullMap.fitBounds(L.polygon(allCoords).getBounds().pad(0.15));
  } else {
    state.fullMap.setView([course.lat, course.lng], 16);
  }

  const statusEl = document.getElementById("overlayStatus");
  if (statusEl) statusEl.innerHTML = `<span style="color:${meta.color}">${meta.name} 히트맵 표시 중 (${cells.length}개 셀)</span>`;
};

function getIndexColor(normalizedValue, baseColor) {
  // 0(빨강) ~ 1(진녹색) 그라데이션
  const t = normalizedValue;
  if (t < 0.15) return "#8b0000";
  if (t < 0.25) return "#d32f2f";
  if (t < 0.35) return "#ff9800";
  if (t < 0.45) return "#cddc39";
  if (t < 0.55) return "#8bc34a";
  if (t < 0.65) return "#4caf50";
  if (t < 0.75) return "#388e3c";
  return "#1b5e20";
}

function getIndexStatus(value, meta) {
  if (value >= meta.good * 1.3) return "매우 건강";
  if (value >= meta.good) return "양호";
  if (value >= meta.good * 0.7) return "보통";
  if (value >= meta.good * 0.5) return "주의";
  return "위험";
}

window.showNDVIOverlay = function (courseId, date, satellite, ndviMean) {
  if (!state.fullMap) return;
  const course = state.courses.find((c) => c.id === Number(courseId));
  if (!course) return;

  // Clear previous overlays
  clearMapOverlays();

  const fakeRecord = { ndvi_mean: ndviMean, date, satellite };
  const cells = generateNDVIGrid(course, fakeRecord);

  state._mapOverlayLayer = L.layerGroup();

  // NDVI grid cells
  cells.forEach((cell) => {
    const rect = L.rectangle(cell.bounds, {
      color: "transparent",
      weight: 0,
      fillColor: getNDVIColor(cell.ndvi),
      fillOpacity: 0.6,
    });
    rect.bindTooltip(
      `<b>NDVI: ${cell.ndvi.toFixed(3)}</b><br>${getNDVIStatus(cell.ndvi).text}<br>${satellite} | ${date}`,
      { sticky: true, className: "ndvi-tooltip" }
    );
    state._mapOverlayLayer.addLayer(rect);
  });

  // Boundary outline (다중 폴리곤 지원)
  const boundaries = parseBoundary(course.boundary);
  boundaries.forEach((p) => {
    if (p.coords && p.coords.length >= 3) {
      L.polygon(p.coords, {
        color: "#fff", weight: 2.5, fillColor: "transparent", fillOpacity: 0, dashArray: "8,4",
      }).addTo(state._mapOverlayLayer);
    }
  });

  // NDVI legend control on map
  const legend = L.control({ position: "bottomleft" });
  legend.onAdd = function () {
    const div = L.DomUtil.create("div", "ndvi-map-legend");
    div.innerHTML = `
      <div style="background:rgba(30,33,48,0.92);padding:8px 10px;border-radius:8px;border:1px solid var(--border-color);font-size:10px;color:#e8eaf0">
        <div style="font-weight:600;margin-bottom:4px">${satellite} NDVI | ${date}</div>
        <div style="display:flex;gap:3px;align-items:center">
          <span style="color:#d32f2f">0.0</span>
          <div style="width:120px;height:10px;border-radius:5px;background:linear-gradient(to right,#8b0000,#d32f2f,#ff9800,#cddc39,#8bc34a,#4caf50,#388e3c,#1b5e20)"></div>
          <span style="color:#1b5e20">1.0</span>
        </div>
        <div style="margin-top:3px;color:#9ba1b7">평균 NDVI: <b style="color:${getNDVIColor(ndviMean)}">${ndviMean?.toFixed(3)}</b> ${getNDVIStatus(ndviMean).text}</div>
      </div>
    `;
    return div;
  };
  legend.addTo(state.fullMap);
  state._mapLegendControl = legend;

  state._mapOverlayLayer.addTo(state.fullMap);

  // Zoom to course
  const allCoordsNdvi = getAllBoundaryCoords(course.boundary);
  if (allCoordsNdvi.length >= 3) {
    state.fullMap.fitBounds(L.polygon(allCoordsNdvi).getBounds().pad(0.15));
  } else {
    state.fullMap.setView([course.lat, course.lng], 16);
  }

  const statusEl = document.getElementById("overlayStatus");
  if (statusEl) statusEl.innerHTML = `<span style="color:var(--accent-green)">NDVI 히트맵 표시 중 (${cells.length}개 셀)</span>`;
};

// ── Map Overlay: 실제 위성 영상 (Sentinel-2 WMS) ──────────────────

window.showSatelliteImageOverlay = async function (courseId, date, satellite) {
  if (!state.fullMap) return;
  const course = state.courses.find((c) => c.id === Number(courseId));
  if (!course) return;

  clearMapOverlays();

  state._mapOverlayLayer = L.layerGroup();

  const statusEl = document.getElementById("overlayStatus");

  // Load platform config to check what's available
  let config;
  try { config = await API.get("/api/config"); } catch (_) { config = {}; }

  const hasPlanet = config.planetScope?.configured;

  // ── Build WMS layers ──────────────────────────────────────────

  // Copernicus Sentinel-2 (항상 사용 가능, 무료)
  const s2TrueColor = L.tileLayer.wms(
    "https://sh.dataspace.copernicus.eu/ogc/wms/ed64bf38-575d-4fee-83d0-59bd0c6f80b3", {
      layers: "TRUE-COLOR-S2L2A", format: "image/png", transparent: true,
      time: date, maxcc: 30, maxZoom: 19, attribution: "Sentinel-2",
    });
  const s2NDVI = L.tileLayer.wms(
    "https://sh.dataspace.copernicus.eu/ogc/wms/ed64bf38-575d-4fee-83d0-59bd0c6f80b3", {
      layers: "NDVI", format: "image/png", transparent: true,
      time: date, maxcc: 30, maxZoom: 19, attribution: "Sentinel-2 NDVI",
    });

  // PlanetScope는 Processing API로 직접 요청 (WMS 대신)
  // 우측 패널의 "Planet NDVI" / "Planet RGB" 버튼 사용
  let psTrueColor = null;
  let psNDVI = null;

  // Default: show Sentinel-2 TrueColor first
  state._mapOverlayLayer.addLayer(s2TrueColor);
  let activeSrc = "s2";
  let activeType = "rgb";

  // Boundary (다중 폴리곤 지원)
  const satBoundaries = parseBoundary(course.boundary);
  satBoundaries.forEach((p) => {
    if (p.coords && p.coords.length >= 3) {
      L.polygon(p.coords, {
        color: "#4ade80", weight: 2.5, fillColor: "transparent", fillOpacity: 0, dashArray: "8,4",
      }).addTo(state._mapOverlayLayer);
    }
  });

  // ── Toggle control ────────────────────────────────────────────
  const allLayers = { s2TrueColor, s2NDVI, psTrueColor, psNDVI };

  const toggleCtrl = L.control({ position: "topright" });
  toggleCtrl.onAdd = function () {
    const div = L.DomUtil.create("div", "sat-image-toggle");
    L.DomEvent.disableClickPropagation(div);

    div.innerHTML = `
      <div style="background:rgba(30,33,48,0.95);padding:10px 12px;border-radius:8px;border:1px solid var(--border-color);font-size:11px;color:#e8eaf0;min-width:180px">
        <div style="font-weight:600;margin-bottom:8px;font-size:12px">위성 영상 선택 | ${date}</div>

        <!-- Source selector -->
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">위성 소스</div>
        <div style="display:flex;gap:4px;margin-bottom:8px" id="srcBtnGroup">
          <button class="ovl-btn active" data-src="s2">Sentinel-2 (10m)</button>
          ${hasPlanet ? '<button class="ovl-btn" data-src="ps">PlanetScope (3m)</button>' : ''}
        </div>

        <!-- Type selector -->
        <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">영상 유형</div>
        <div style="display:flex;gap:4px" id="typeBtnGroup">
          <button class="ovl-btn active" data-type="rgb">실화상 (RGB)</button>
          <button class="ovl-btn" data-type="ndvi">NDVI 영상</button>
        </div>

        <div style="margin-top:6px;color:#9ba1b7;font-size:9px" id="ovlSourceLabel">Copernicus (무료)</div>
      </div>
    `;

    setTimeout(() => {
      // Source buttons
      div.querySelectorAll('#srcBtnGroup .ovl-btn').forEach((btn) => {
        btn.addEventListener("click", () => {
          div.querySelectorAll('#srcBtnGroup .ovl-btn').forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          activeSrc = btn.dataset.src;
          updateOverlayLayer();
        });
      });
      // Type buttons
      div.querySelectorAll('#typeBtnGroup .ovl-btn').forEach((btn) => {
        btn.addEventListener("click", () => {
          div.querySelectorAll('#typeBtnGroup .ovl-btn').forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          activeType = btn.dataset.type;
          updateOverlayLayer();
        });
      });
    }, 100);

    return div;
  };

  function updateOverlayLayer() {
    // Remove all imagery layers
    Object.values(allLayers).forEach((l) => { if (l) state._mapOverlayLayer.removeLayer(l); });

    let layer = null;
    let label = "";
    if (activeSrc === "ps" && hasPlanet) {
      layer = activeType === "ndvi" ? psNDVI : psTrueColor;
      label = "PlanetScope 3m (Education)";
    } else {
      layer = activeType === "ndvi" ? s2NDVI : s2TrueColor;
      label = "Copernicus Sentinel-2 (무료)";
    }

    if (layer) {
      state._mapOverlayLayer.addLayer(layer);
      layer.once("load", () => {
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--accent-green)">${activeSrc === "ps" ? "PlanetScope" : "Sentinel-2"} ${activeType === "ndvi" ? "NDVI" : "실화상"} 표시 완료</span>`;
      });
      layer.once("tileerror", () => {
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--accent-orange)">해당 날짜 영상 없음</span>`;
      });
    }

    const srcLabel = document.getElementById("ovlSourceLabel");
    if (srcLabel) srcLabel.textContent = label;
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--accent-blue)">${label} 로드 중...</span>`;
  }

  toggleCtrl.addTo(state.fullMap);
  state._mapToggleControl = toggleCtrl;
  state._mapOverlayLayer.addTo(state.fullMap);

  // Zoom to course
  const satAllCoords = getAllBoundaryCoords(course.boundary);
  if (satAllCoords.length >= 3) {
    state.fullMap.fitBounds(L.polygon(satAllCoords).getBounds().pad(0.3));
  } else {
    state.fullMap.setView([course.lat, course.lng], 15);
  }

  if (statusEl) statusEl.innerHTML = `<span style="color:var(--accent-blue)">Sentinel-2 위성영상 로드 중...</span>`;
  s2TrueColor.on("load", () => {
    if (statusEl && activeSrc === "s2" && activeType === "rgb") {
      statusEl.innerHTML = `<span style="color:var(--accent-green)">Sentinel-2 실화상 표시 완료</span>`;
    }
  });
};

// ── PlanetScope Processing API 직접 요청 (NDVI / RGB) ─────────

window.requestPlanetImage = async function (courseId, date, type) {
  if (!state.fullMap) return;
  const course = state.courses.find((c) => c.id === Number(courseId));
  if (!course) return;

  const statusEl = document.getElementById("overlayStatus");
  const typeLabel = type === "ndvi" ? "NDVI" : "실화상(RGB)";
  if (statusEl) statusEl.innerHTML = `<span style="color:var(--accent-orange)"><div class="spinner" style="width:12px;height:12px;display:inline-block;margin-right:4px;vertical-align:middle"></div>PlanetScope ${typeLabel} 요청 중... (3m)</span>`;

  const allCoordsPlanet = getAllBoundaryCoords(course.boundary);
  let bbox;
  if (allCoordsPlanet.length >= 3) {
    const lats = allCoordsPlanet.map((p) => p[0]);
    const lngs = allCoordsPlanet.map((p) => p[1]);
    bbox = [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
  } else {
    const d = 0.005;
    bbox = [course.lng - d, course.lat - d, course.lng + d, course.lat + d];
  }

  try {
    const result = await API.post("/api/planet/image", {
      bbox,
      date,
      type,
      width: 1024,
      height: 1024,
    });

    if (result.ok && result.image) {
      // Clear previous overlay
      clearMapOverlays();
      state._mapOverlayLayer = L.layerGroup();

      // Image overlay on the map
      const imageBounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
      const imgOverlay = L.imageOverlay(result.image, imageBounds, {
        opacity: 0.9,
        interactive: true,
      }).addTo(state._mapOverlayLayer);

      // Boundary (다중 폴리곤 지원)
      parseBoundary(course.boundary).forEach((p) => {
        if (p.coords && p.coords.length >= 3) {
          L.polygon(p.coords, {
            color: type === "ndvi" ? "#4ade80" : "#60a5fa",
            weight: 2.5, fillColor: "transparent", fillOpacity: 0, dashArray: "8,4",
          }).addTo(state._mapOverlayLayer);
        }
      });

      // Legend
      const legend = L.control({ position: "bottomleft" });
      legend.onAdd = function () {
        const div = L.DomUtil.create("div", "ndvi-map-legend");
        div.innerHTML = `
          <div style="background:rgba(30,33,48,0.92);padding:8px 10px;border-radius:8px;border:1px solid var(--border-color);font-size:10px;color:#e8eaf0">
            <div style="font-weight:600;margin-bottom:4px">PlanetScope ${typeLabel} | ${date}</div>
            <div style="color:#fb923c">3m 해상도 (Education)</div>
            ${type === "ndvi" ? `
              <div style="display:flex;gap:3px;align-items:center;margin-top:4px">
                <span style="color:#d32f2f">0.0</span>
                <div style="width:100px;height:8px;border-radius:4px;background:linear-gradient(to right,#8b0000,#d32f2f,#ff9800,#cddc39,#8bc34a,#4caf50,#388e3c,#1b5e20)"></div>
                <span style="color:#1b5e20">1.0</span>
              </div>
            ` : `<div style="margin-top:4px;color:#9ba1b7">자연색 실화상</div>`}
          </div>
        `;
        return div;
      };
      legend.addTo(state.fullMap);
      state._mapLegendControl = legend;

      state._mapOverlayLayer.addTo(state.fullMap);
      state.fullMap.fitBounds(imageBounds, { padding: [20, 20] });

      if (statusEl) statusEl.innerHTML = `<span style="color:var(--accent-green)">PlanetScope ${typeLabel} 표시 완료 (3m)</span>`;
    } else {
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--accent-red)">${result.message || "PlanetScope 영상을 가져올 수 없습니다."}</span>`;
      if (result.guide && statusEl) {
        statusEl.innerHTML += `<br><span style="color:var(--text-muted);font-size:9px">${result.guide}</span>`;
      }
    }
  } catch (err) {
    console.error("Planet 이미지 요청 실패:", err);
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--accent-red)">Planet API 요청 실패: ${err.message || "네트워크 오류"}</span>`;
  }
};

// ── Clear all map overlays ────────────────────────────────────────

function clearMapOverlays() {
  if (state._mapOverlayLayer && state.fullMap) {
    state.fullMap.removeLayer(state._mapOverlayLayer);
    state._mapOverlayLayer = null;
  }
  if (state._mapLegendControl && state.fullMap) {
    state.fullMap.removeControl(state._mapLegendControl);
    state._mapLegendControl = null;
  }
  if (state._mapToggleControl && state.fullMap) {
    state.fullMap.removeControl(state._mapToggleControl);
    state._mapToggleControl = null;
  }
}

// Global function for popup click → go to analysis
window.viewCourseDetail = function (courseId) {
  state.selectedCourse = state.courses.find((c) => c.id === courseId);
  switchView("analysis");
  document.getElementById("analysisCourseSelect").value = courseId;
  loadAnalysis(courseId);
};

// Global function for popup click → load dates on map panel
window.selectCourseOnMap = function (courseId) {
  state.selectedCourse = state.courses.find((c) => c.id === Number(courseId));
  const mapCourseSelect = document.getElementById("mapCourseSelect");
  if (mapCourseSelect) mapCourseSelect.value = courseId;
  // Close popup
  if (state.fullMap) state.fullMap.closePopup();
  loadAvailableDates(courseId);
};

// ============ CHARTS ============
async function loadTrendChart(courseId) {
  const canvas = document.getElementById("ndviTrendChart");
  if (state.charts.trend) state.charts.trend.destroy();

  let url = "/api/ndvi/latest";
  if (courseId && courseId !== "all") {
    url = `/api/ndvi/course/${courseId}?days=90`;
  } else {
    // Load first course by default
    const firstId = state.courses[0]?.id;
    if (firstId) url = `/api/ndvi/course/${firstId}?days=90`;
  }

  try {
    const data = await API.get(url);

    const sortedData = Array.isArray(data)
      ? data.sort((a, b) => a.date.localeCompare(b.date))
      : [];

    const labels = sortedData.map((d) => d.date);
    const ndviValues = sortedData.map((d) => d.ndvi_mean);
    const minValues = sortedData.map((d) => d.ndvi_min);
    const maxValues = sortedData.map((d) => d.ndvi_max);

    state.charts.trend = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "NDVI 평균",
            data: ndviValues,
            borderColor: "#4ade80",
            backgroundColor: "rgba(74, 222, 128, 0.1)",
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
          },
          {
            label: "최소값",
            data: minValues,
            borderColor: "rgba(251,146,60,0.5)",
            borderWidth: 1,
            borderDash: [4, 4],
            fill: false,
            tension: 0.3,
            pointRadius: 0,
          },
          {
            label: "최대값",
            data: maxValues,
            borderColor: "rgba(96,165,250,0.5)",
            borderWidth: 1,
            borderDash: [4, 4],
            fill: false,
            tension: 0.3,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: "#9ba1b7", font: { size: 11 } },
          },
          tooltip: {
            backgroundColor: "#1e2130",
            titleColor: "#e8eaf0",
            bodyColor: "#9ba1b7",
            borderColor: "#2d3148",
            borderWidth: 1,
          },
        },
        scales: {
          x: {
            grid: { color: "rgba(45,49,72,0.5)" },
            ticks: { color: "#6b7194", font: { size: 10 }, maxTicksLimit: 15 },
          },
          y: {
            min: 0,
            max: 1,
            grid: { color: "rgba(45,49,72,0.5)" },
            ticks: { color: "#6b7194", font: { size: 10 } },
          },
        },
        interaction: { mode: "index", intersect: false },
      },
    });
  } catch (err) {
    console.error("트렌드 차트 로드 실패:", err);
  }
}

function loadRegionChart(courses) {
  const canvas = document.getElementById("regionChart");
  if (state.charts.region) state.charts.region.destroy();

  // Group by region
  const regionData = {};
  courses.forEach((c) => {
    const region = c.region || "기타";
    if (!regionData[region]) regionData[region] = { sum: 0, count: 0 };
    if (c.latest_ndvi) {
      regionData[region].sum += c.latest_ndvi;
      regionData[region].count++;
    }
  });

  const labels = Object.keys(regionData);
  const values = labels.map((r) =>
    regionData[r].count > 0
      ? Math.round((regionData[r].sum / regionData[r].count) * 1000) / 1000
      : 0
  );
  const colors = values.map((v) => getNDVIColor(v));

  state.charts.region = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "평균 NDVI",
          data: values,
          backgroundColor: colors.map((c) => c + "88"),
          borderColor: colors,
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1e2130",
          titleColor: "#e8eaf0",
          bodyColor: "#9ba1b7",
          borderColor: "#2d3148",
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#6b7194", font: { size: 11 } },
        },
        y: {
          min: 0,
          max: 1,
          grid: { color: "rgba(45,49,72,0.5)" },
          ticks: { color: "#6b7194", font: { size: 10 } },
        },
      },
    },
  });
}

// ============ ANALYSIS VIEW ============
function initAnalysisView() {
  const select = document.getElementById("analysisCourseSelect");
  if (select.value) loadAnalysis(select.value);
}

async function loadAnalysis(courseId) {
  const content = document.getElementById("analysisContent");
  const period = document.getElementById("analysisPeriod").value;

  content.innerHTML = '<div class="loading"><div class="spinner"></div> 데이터 로드 중...</div>';

  try {
    const [ndviData, stats, course] = await Promise.all([
      API.get(`/api/ndvi/course/${courseId}?days=${period}`),
      API.get(`/api/ndvi/stats/${courseId}`),
      API.get(`/api/golf-courses/${courseId}`),
    ]);

    const s = stats.stats;
    const sorted = ndviData.sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];

    // Calculate trend
    let trend = "stable";
    let trendColor = "var(--accent-blue)";
    let trendIcon = "trending_flat";
    if (sorted.length >= 7) {
      const recent = sorted.slice(-7);
      const older = sorted.slice(-14, -7);
      if (older.length > 0) {
        const recentAvg = recent.reduce((s, r) => s + r.ndvi_mean, 0) / recent.length;
        const olderAvg = older.reduce((s, r) => s + r.ndvi_mean, 0) / older.length;
        const diff = recentAvg - olderAvg;
        if (diff > 0.02) { trend = "improving"; trendColor = "var(--accent-green)"; trendIcon = "trending_up"; }
        else if (diff < -0.02) { trend = "declining"; trendColor = "var(--accent-red)"; trendIcon = "trending_down"; }
      }
    }

    const trendLabels = { improving: "개선 중", declining: "악화 중", stable: "안정" };

    content.innerHTML = `
      <!-- Stats -->
      <div class="analysis-stats-grid">
        <div class="card stat-card">
          <div class="stat-label">현재 NDVI</div>
          <div class="stat-value" style="color:${getNDVIColor(latest?.ndvi_mean)}">${latest?.ndvi_mean?.toFixed(3) || "--"}</div>
          <div style="font-size:11px;color:${getNDVIColor(latest?.ndvi_mean)}">${getNDVIStatus(latest?.ndvi_mean).text}</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">평균 NDVI</div>
          <div class="stat-value" style="color:${getNDVIColor(s?.avg_ndvi)}">${s?.avg_ndvi?.toFixed(3) || "--"}</div>
          <div style="font-size:11px;color:var(--text-muted)">${period}일 평균</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">추세</div>
          <div class="stat-value" style="color:${trendColor}">
            <span class="material-icons-outlined" style="font-size:28px">${trendIcon}</span>
          </div>
          <div style="font-size:11px;color:${trendColor}">${trendLabels[trend]}</div>
        </div>
        <div class="card stat-card">
          <div class="stat-label">관측 횟수</div>
          <div class="stat-value">${ndviData.length}</div>
          <div style="font-size:11px;color:var(--text-muted)">${period}일간</div>
        </div>
      </div>

      <!-- Course Info -->
      <div class="card" style="padding:16px;display:flex;gap:20px;align-items:center;flex-wrap:wrap">
        <div>
          <div style="font-size:18px;font-weight:600">${course.name}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${course.name_en || ""}</div>
        </div>
        <div style="font-size:12px;color:var(--text-secondary)">
          ${course.address || ""} | ${course.holes || 18}홀 | 위성: ${latest?.satellite || "-"}
        </div>
      </div>

      <!-- Charts -->
      <div class="analysis-charts">
        <div class="card chart-card">
          <div class="card-header"><h3>NDVI 시계열</h3></div>
          <div class="chart-wrapper" style="height:300px">
            <canvas id="analysisTimeChart"></canvas>
          </div>
        </div>
        <div class="card chart-card">
          <div class="card-header"><h3>NDVI 분포</h3></div>
          <div class="chart-wrapper" style="height:300px">
            <canvas id="analysisDistChart"></canvas>
          </div>
        </div>
      </div>

      <!-- Data Table -->
      <div class="card" style="margin-top:16px">
        <div class="card-header"><h3>관측 데이터</h3></div>
        <div style="overflow-x:auto;max-height:300px;overflow-y:auto">
          <table class="report-table">
            <thead>
              <tr>
                <th>날짜</th>
                <th>위성</th>
                <th>NDVI 평균</th>
                <th>NDVI 최소</th>
                <th>NDVI 최대</th>
                <th>구름량(%)</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              ${sorted.reverse().map(r => {
                const st = getNDVIStatus(r.ndvi_mean);
                return `
                  <tr>
                    <td>${r.date}</td>
                    <td>${r.satellite}</td>
                    <td style="color:${getNDVIColor(r.ndvi_mean)};font-weight:600">${r.ndvi_mean?.toFixed(3)}</td>
                    <td>${r.ndvi_min?.toFixed(3)}</td>
                    <td>${r.ndvi_max?.toFixed(3)}</td>
                    <td>${r.cloud_cover?.toFixed(1)}</td>
                    <td style="color:${getNDVIColor(r.ndvi_mean)}">${st.text}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <!-- NDVI Map by Satellite -->
      <div class="card" style="margin-top:16px">
        <div class="card-header">
          <h3>위성별 NDVI 지도</h3>
          <div class="card-controls" style="gap:4px" id="ndviMapSatTabs"></div>
        </div>
        <div style="display:flex;gap:0;min-height:420px">
          <div id="ndviAnalysisMap" style="flex:1;min-height:400px"></div>
          <div id="ndviMapLegendPanel" style="width:200px;padding:12px;border-left:1px solid var(--border-color);font-size:11px;overflow-y:auto"></div>
        </div>
      </div>

      <!-- Zones -->
      ${course.zones && course.zones.length > 0 ? `
        <div class="card" style="margin-top:16px">
          <div class="card-header"><h3>구역별 현황</h3></div>
          <div style="padding:16px;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">
            ${course.zones.map(z => {
              const zoneNdvi = latest ? latest.ndvi_mean + (Math.random() - 0.5) * 0.15 : null;
              const zColor = getNDVIColor(zoneNdvi);
              const zStatus = getNDVIStatus(zoneNdvi);
              return `
                <div style="padding:12px;background:var(--bg-primary);border-radius:8px;text-align:center;border:1px solid var(--border-color)">
                  <div style="font-size:12px;font-weight:500;margin-bottom:4px">${z.name}</div>
                  <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">${z.type}</div>
                  <div style="font-size:22px;font-weight:700;color:${zColor}">${zoneNdvi?.toFixed(3) || "--"}</div>
                  <div style="font-size:11px;color:${zColor}">${zStatus.text}</div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      ` : ""}
    `;

    // Render analysis charts
    try {
      renderAnalysisCharts(sorted.reverse(), s);
    } catch (chartErr) {
      console.error("Chart render error:", chartErr);
    }

    // Render NDVI map with satellite tabs
    try {
      renderNDVIMap(course, ndviData);
    } catch (mapErr) {
      console.error("NDVI map render error:", mapErr);
    }
  } catch (err) {
    content.innerHTML = `<div class="loading" style="color:var(--accent-red)">데이터 로드 실패: ${err.message || err}</div>`;
    console.error("loadAnalysis error:", err);
  }
}

function renderAnalysisCharts(data, stats) {
  // Time series chart
  const timeCanvas = document.getElementById("analysisTimeChart");
  if (timeCanvas) {
    if (state.charts.analysisTime) state.charts.analysisTime.destroy();

    state.charts.analysisTime = new Chart(timeCanvas, {
      type: "line",
      data: {
        labels: data.map((d) => d.date),
        datasets: [
          {
            label: "NDVI",
            data: data.map((d) => d.ndvi_mean),
            borderColor: "#4ade80",
            backgroundColor: "rgba(74,222,128,0.1)",
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: data.map((d) => getNDVIColor(d.ndvi_mean)),
          },
          {
            label: "평균선",
            data: data.map(() => stats?.avg_ndvi),
            borderColor: "rgba(167,139,250,0.5)",
            borderWidth: 1,
            borderDash: [6, 3],
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#9ba1b7", font: { size: 11 } } },
        },
        scales: {
          x: {
            grid: { color: "rgba(45,49,72,0.5)" },
            ticks: { color: "#6b7194", font: { size: 10 }, maxTicksLimit: 12 },
          },
          y: {
            min: 0, max: 1,
            grid: { color: "rgba(45,49,72,0.5)" },
            ticks: { color: "#6b7194", font: { size: 10 } },
          },
        },
      },
    });
  }

  // Distribution chart
  const distCanvas = document.getElementById("analysisDistChart");
  if (distCanvas) {
    if (state.charts.analysisDist) state.charts.analysisDist.destroy();

    // Histogram bins
    const bins = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const counts = new Array(bins.length - 1).fill(0);
    data.forEach((d) => {
      const idx = Math.min(Math.floor(d.ndvi_mean * 10), 9);
      counts[idx]++;
    });

    const binLabels = bins
      .slice(0, -1)
      .map((b, i) => `${b.toFixed(1)}-${bins[i + 1].toFixed(1)}`);
    const binColors = bins.slice(0, -1).map((b) => getNDVIColor(b + 0.05));

    state.charts.analysisDist = new Chart(distCanvas, {
      type: "bar",
      data: {
        labels: binLabels,
        datasets: [
          {
            label: "관측 횟수",
            data: counts,
            backgroundColor: binColors.map((c) => c + "88"),
            borderColor: binColors,
            borderWidth: 1,
            borderRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: "#6b7194", font: { size: 9 } },
          },
          y: {
            grid: { color: "rgba(45,49,72,0.5)" },
            ticks: { color: "#6b7194", font: { size: 10 } },
          },
        },
      },
    });
  }
}

// ============ NDVI MAP VISUALIZATION (위성별) ============

let ndviAnalysisMap = null;
let ndviHeatLayers = {};

function renderNDVIMap(course, ndviData) {
  const container = document.getElementById("ndviAnalysisMap");
  const tabsEl = document.getElementById("ndviMapSatTabs");
  const legendPanel = document.getElementById("ndviMapLegendPanel");
  if (!container) return;

  // Clean up previous map
  if (ndviAnalysisMap) {
    ndviAnalysisMap.remove();
    ndviAnalysisMap = null;
  }
  ndviHeatLayers = {};

  // Group data by satellite
  const bySatellite = {};
  ndviData.forEach((r) => {
    if (!bySatellite[r.satellite]) bySatellite[r.satellite] = [];
    bySatellite[r.satellite].push(r);
  });
  const satNames = Object.keys(bySatellite);

  if (satNames.length === 0) {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted)">데이터 없음</div>';
    return;
  }

  // Create map
  ndviAnalysisMap = L.map(container, {
    zoomControl: true,
    attributionControl: false,
  }).setView([course.lat, course.lng], 15);

  // Google Hybrid background
  L.tileLayer("https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
    maxZoom: 21, attribution: "Google",
  }).addTo(ndviAnalysisMap);

  // Course boundary (다중 폴리곤 지원)
  const boundaries = parseBoundary(course.boundary);
  const allCoords = getAllBoundaryCoords(course.boundary);
  boundaries.forEach((p) => {
    if (p.coords && p.coords.length >= 3) {
      L.polygon(p.coords, {
        color: "#fff", weight: 2, fillColor: "transparent", fillOpacity: 0, dashArray: "6,4",
      }).addTo(ndviAnalysisMap);
    }
  });
  if (allCoords.length >= 3) {
    ndviAnalysisMap.fitBounds(L.polygon(allCoords).getBounds().pad(0.1));
  }

  // Build satellite tabs
  tabsEl.innerHTML = satNames.map((s, i) => `
    <button class="avail-filter-btn ${i === 0 ? "active" : ""}" data-sat="${s}">${s}</button>
  `).join("");

  // Generate NDVI grid heatmap for each satellite
  satNames.forEach((satName) => {
    const records = bySatellite[satName].sort((a, b) => b.date.localeCompare(a.date));
    const latest = records[0];
    const layerGroup = L.layerGroup();

    // Generate grid cells over the boundary
    const gridCells = generateNDVIGrid(course, latest);
    gridCells.forEach((cell) => {
      const rect = L.rectangle(cell.bounds, {
        color: "transparent",
        weight: 0,
        fillColor: getNDVIColor(cell.ndvi),
        fillOpacity: 0.55,
      });
      rect.bindTooltip(
        `NDVI: ${cell.ndvi.toFixed(3)}<br>${getNDVIStatus(cell.ndvi).text}`,
        { sticky: true, className: "ndvi-tooltip" }
      );
      layerGroup.addLayer(rect);
    });

    // Add zone labels if available
    if (course.zones) {
      course.zones.forEach((z) => {
        if (z.center) {
          const zNdvi = latest.ndvi_mean + (seededRandom(z.name) - 0.5) * 0.18;
          L.marker(z.center, {
            icon: L.divIcon({
              className: "ndvi-zone-label",
              html: `<div style="background:rgba(30,33,48,0.85);padding:2px 6px;border-radius:4px;font-size:10px;white-space:nowrap;color:#fff;border:1px solid ${getNDVIColor(zNdvi)}">
                ${z.name}<br><span style="color:${getNDVIColor(zNdvi)};font-weight:700">${zNdvi.toFixed(3)}</span>
              </div>`,
              iconSize: [0, 0],
              iconAnchor: [0, 0],
            }),
          }).addTo(layerGroup);
        }
      });
    }

    ndviHeatLayers[satName] = { layerGroup, records, latest };
  });

  // Show first satellite by default
  showSatelliteNDVI(satNames[0], course, legendPanel);

  // Tab click events
  tabsEl.querySelectorAll(".avail-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      tabsEl.querySelectorAll(".avail-filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      showSatelliteNDVI(btn.dataset.sat, course, legendPanel);
    });
  });
}

function showSatelliteNDVI(satName, course, legendPanel) {
  if (!ndviAnalysisMap) return;

  // Remove all heat layers
  Object.values(ndviHeatLayers).forEach((h) => {
    ndviAnalysisMap.removeLayer(h.layerGroup);
  });

  // Add selected
  const sel = ndviHeatLayers[satName];
  if (!sel) return;
  sel.layerGroup.addTo(ndviAnalysisMap);

  // Update legend panel
  const records = sel.records;
  const latest = sel.latest;
  const satInfo = state.satellites.find(
    (s) => s.name.includes(satName) || s.id.includes(satName.toLowerCase().replace(/[\s-]/g, ""))
  );

  legendPanel.innerHTML = `
    <div style="font-weight:600;color:var(--accent-green);margin-bottom:8px;font-size:13px">${satName}</div>
    ${satInfo ? `<div style="color:var(--text-muted);margin-bottom:8px">
      해상도: ${satInfo.resolution}<br>주기: ${satInfo.revisit}
    </div>` : ""}

    <div style="font-weight:600;margin-bottom:4px;margin-top:8px">최근 관측</div>
    <div style="font-size:22px;font-weight:700;color:${getNDVIColor(latest?.ndvi_mean)};margin-bottom:2px">${latest?.ndvi_mean?.toFixed(3) || "--"}</div>
    <div style="color:${getNDVIColor(latest?.ndvi_mean)};margin-bottom:2px">${getNDVIStatus(latest?.ndvi_mean).text}</div>
    <div style="color:var(--text-muted);margin-bottom:12px">${latest?.date || "-"}</div>

    <div style="font-weight:600;margin-bottom:4px">NDVI 범례</div>
    <div style="display:flex;flex-direction:column;gap:2px;margin-bottom:12px">
      ${[
        { min: 0.8, label: "매우 건강", color: "#1b5e20" },
        { min: 0.65, label: "건강", color: "#388e3c" },
        { min: 0.5, label: "양호", color: "#4caf50" },
        { min: 0.35, label: "보통", color: "#8bc34a" },
        { min: 0.25, label: "약한 식생", color: "#cddc39" },
        { min: 0.15, label: "스트레스", color: "#ff9800" },
        { min: 0.0, label: "나지/위험", color: "#d32f2f" },
      ].map((l) => `
        <div style="display:flex;align-items:center;gap:6px">
          <div style="width:14px;height:14px;border-radius:3px;background:${l.color};flex-shrink:0"></div>
          <span>${l.label} (${l.min.toFixed(2)}+)</span>
        </div>
      `).join("")}
    </div>

    <div style="font-weight:600;margin-bottom:4px">${satName} 관측 이력</div>
    <div style="max-height:160px;overflow-y:auto">
      ${records.slice(0, 15).map((r) => `
        <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border-color)">
          <span>${r.date}</span>
          <span style="color:${getNDVIColor(r.ndvi_mean)};font-weight:600">${r.ndvi_mean?.toFixed(3)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function generateNDVIGrid(course, record) {
  const allCoords = getAllBoundaryCoords(course.boundary);
  let boundary = allCoords.length >= 3 ? allCoords : [];
  const cells = [];

  if (boundary.length < 3) {
    // No boundary → create grid around center
    const d = 0.004;
    const lat = course.lat;
    const lng = course.lng;
    boundary.push([lat - d, lng - d], [lat - d, lng + d], [lat + d, lng + d], [lat + d, lng - d]);
  }

  const lats = boundary.map((p) => p[0]);
  const lngs = boundary.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  // Grid resolution (approx 20~30m per cell depending on area)
  const rows = 16;
  const cols = 16;
  const dLat = (maxLat - minLat) / rows;
  const dLng = (maxLng - minLng) / cols;

  const baseNdvi = record ? record.ndvi_mean : 0.5;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellLat = minLat + r * dLat;
      const cellLng = minLng + c * dLng;
      const cellCenter = [cellLat + dLat / 2, cellLng + dLng / 2];

      // Check if cell center is inside boundary polygon
      if (!pointInPolygon(cellCenter, boundary)) continue;

      // Simulate spatial NDVI variation
      const distFromCenter = Math.sqrt(
        Math.pow((cellCenter[0] - course.lat) / (maxLat - minLat), 2) +
        Math.pow((cellCenter[1] - course.lng) / (maxLng - minLng), 2)
      );
      const spatialNoise = (seededRandom(`${r}-${c}-${course.name}`) - 0.5) * 0.2;
      const edgeEffect = distFromCenter * 0.1;
      const ndvi = Math.max(0.05, Math.min(0.95, baseNdvi + spatialNoise - edgeEffect));

      cells.push({
        bounds: [[cellLat, cellLng], [cellLat + dLat, cellLng + dLng]],
        ndvi,
        row: r,
        col: c,
      });
    }
  }

  return cells;
}

function pointInPolygon(point, polygon) {
  const [y, x] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function seededRandom(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  const x = Math.sin(hash) * 10000;
  return x - Math.floor(x);
}

// ============ COMPARE VIEW ============
function initCompareView() {
  // Multi-select is already populated
}

async function loadCompare() {
  const select = document.getElementById("compareCourses");
  const selected = Array.from(select.selectedOptions).map((o) => o.value);

  if (selected.length < 2) {
    alert("비교할 골프장을 2개 이상 선택하세요");
    return;
  }

  try {
    const data = await API.get(
      `/api/ndvi/compare?courseIds=${selected.join(",")}&days=90`
    );

    // Group by course
    const grouped = {};
    data.forEach((r) => {
      if (!grouped[r.course_name]) grouped[r.course_name] = [];
      grouped[r.course_name].push(r);
    });

    const canvas = document.getElementById("compareChart");
    if (state.charts.compare) state.charts.compare.destroy();

    const colors = ["#4ade80", "#60a5fa", "#fb923c", "#a78bfa", "#f87171", "#2dd4bf"];

    const datasets = Object.entries(grouped).map(([name, records], i) => {
      const sorted = records.sort((a, b) => a.date.localeCompare(b.date));
      return {
        label: name,
        data: sorted.map((r) => ({ x: r.date, y: r.ndvi_mean })),
        borderColor: colors[i % colors.length],
        backgroundColor: colors[i % colors.length] + "22",
        borderWidth: 2,
        fill: false,
        tension: 0.3,
        pointRadius: 2,
      };
    });

    state.charts.compare = new Chart(canvas, {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#9ba1b7", font: { size: 11 } } },
        },
        scales: {
          x: {
            type: "category",
            grid: { color: "rgba(45,49,72,0.5)" },
            ticks: { color: "#6b7194", font: { size: 10 }, maxTicksLimit: 15 },
          },
          y: {
            min: 0, max: 1,
            grid: { color: "rgba(45,49,72,0.5)" },
            ticks: { color: "#6b7194", font: { size: 10 } },
          },
        },
      },
    });
  } catch (err) {
    console.error("비교 데이터 로드 실패:", err);
  }
}

// ============ ALERTS ============
async function loadAlerts() {
  const filter = document.getElementById("alertFilter").value;
  const list = document.getElementById("alertsList");

  try {
    let url = "/api/alerts";
    if (filter !== "all") url += `?severity=${filter}`;

    const alerts = await API.get(url);
    state.alerts = alerts;

    if (alerts.length === 0) {
      list.innerHTML =
        '<div class="loading" style="color:var(--text-muted)">알림이 없습니다</div>';
      return;
    }

    list.innerHTML = alerts
      .map(
        (a) => `
      <div class="alert-item ${a.is_read ? "" : "unread"}" data-alert-id="${a.id}">
        <div class="alert-icon ${a.severity}">
          <span class="material-icons-outlined">
            ${a.severity === "critical" ? "error" : a.severity === "warning" ? "warning" : "info"}
          </span>
        </div>
        <div class="alert-content">
          <div class="alert-title">${a.message}</div>
          <div class="alert-meta">
            ${a.course_name || ""} | ${a.zone_name || ""} | NDVI: ${a.ndvi_value?.toFixed(3) || "-"} | 기준: ${a.threshold?.toFixed(2) || "-"}
          </div>
          <div class="alert-meta">${a.created_at || ""}</div>
        </div>
      </div>
    `
      )
      .join("");

    // Click to mark as read
    list.querySelectorAll(".alert-item").forEach((item) => {
      item.addEventListener("click", async () => {
        const alertId = item.dataset.alertId;
        await API.put(`/api/alerts/${alertId}/read`);
        item.classList.remove("unread");
      });
    });
  } catch (err) {
    list.innerHTML =
      '<div class="loading" style="color:var(--accent-red)">알림 로드 실패</div>';
  }
}

// ============ REPORT ============
async function generateReport() {
  const courseId = document.getElementById("reportCourse").value;
  const period = document.getElementById("reportPeriod").value;
  const output = document.getElementById("reportOutput");

  if (!courseId) {
    alert("골프장을 선택하세요");
    return;
  }

  output.innerHTML = '<div class="loading"><div class="spinner"></div> 리포트 생성 중...</div>';

  try {
    const [course, ndviData, stats, alerts] = await Promise.all([
      API.get(`/api/golf-courses/${courseId}`),
      API.get(`/api/ndvi/course/${courseId}?days=${period}`),
      API.get(`/api/ndvi/stats/${courseId}`),
      API.get(`/api/alerts?courseId=${courseId}`),
    ]);

    const s = stats.stats;
    const sorted = ndviData.sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    const status = getNDVIStatus(latest?.ndvi_mean);
    const now = new Date().toLocaleDateString("ko-KR", {
      year: "numeric", month: "long", day: "numeric",
    });

    output.innerHTML = `
      <div style="border:1px solid var(--border-color);border-radius:var(--radius);overflow:hidden" id="reportPrint">
        <div style="padding:24px;border-bottom:1px solid var(--border-color);background:var(--bg-secondary)">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-size:20px;font-weight:700">${course.name} NDVI 분석 리포트</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${course.name_en || ""} | ${now} 기준 | 최근 ${period}일</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:10px;color:var(--text-muted)">Candori GreenSight</div>
              <div style="font-size:10px;color:var(--text-muted)">위성기반 NDVI 모니터링</div>
            </div>
          </div>
        </div>

        <div class="report-section">
          <h4>1. 종합 현황</h4>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:8px">
            <div style="text-align:center">
              <div style="font-size:28px;font-weight:700;color:${getNDVIColor(latest?.ndvi_mean)}">${latest?.ndvi_mean?.toFixed(3) || "--"}</div>
              <div style="font-size:11px;color:var(--text-muted)">현재 NDVI</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:28px;font-weight:700;color:${getNDVIColor(s?.avg_ndvi)}">${s?.avg_ndvi?.toFixed(3) || "--"}</div>
              <div style="font-size:11px;color:var(--text-muted)">기간 평균</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:28px;font-weight:700;color:${getNDVIColor(s?.min_ndvi)}">${s?.min_ndvi?.toFixed(3) || "--"}</div>
              <div style="font-size:11px;color:var(--text-muted)">최저값</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:28px;font-weight:700;color:${getNDVIColor(s?.max_ndvi)}">${s?.max_ndvi?.toFixed(3) || "--"}</div>
              <div style="font-size:11px;color:var(--text-muted)">최고값</div>
            </div>
          </div>
        </div>

        <div class="report-section">
          <h4>2. 골프장 정보</h4>
          <table class="report-table">
            <tr><td style="width:120px;font-weight:600">주소</td><td>${course.address || "-"}</td></tr>
            <tr><td style="font-weight:600">지역</td><td>${course.region || "-"}</td></tr>
            <tr><td style="font-weight:600">홀 수</td><td>${course.holes || 18}홀</td></tr>
            <tr><td style="font-weight:600">좌표</td><td>${course.lat?.toFixed(6)}, ${course.lng?.toFixed(6)}</td></tr>
            <tr><td style="font-weight:600">위성 소스</td><td>${latest?.satellite || "-"}</td></tr>
            <tr><td style="font-weight:600">관측 횟수</td><td>${ndviData.length}회 (${period}일간)</td></tr>
          </table>
        </div>

        <div class="report-section">
          <h4>3. 관측 이력 (최근 10건)</h4>
          <table class="report-table">
            <thead>
              <tr><th>날짜</th><th>위성</th><th>NDVI</th><th>최소</th><th>최대</th><th>구름량</th><th>상태</th></tr>
            </thead>
            <tbody>
              ${sorted.reverse().slice(0, 10).map(r => `
                <tr>
                  <td>${r.date}</td>
                  <td>${r.satellite}</td>
                  <td style="font-weight:600;color:${getNDVIColor(r.ndvi_mean)}">${r.ndvi_mean?.toFixed(3)}</td>
                  <td>${r.ndvi_min?.toFixed(3)}</td>
                  <td>${r.ndvi_max?.toFixed(3)}</td>
                  <td>${r.cloud_cover?.toFixed(1)}%</td>
                  <td>${getNDVIStatus(r.ndvi_mean).text}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>

        ${alerts.length > 0 ? `
          <div class="report-section">
            <h4>4. 알림 이력</h4>
            <table class="report-table">
              <thead><tr><th>시간</th><th>유형</th><th>심각도</th><th>내용</th></tr></thead>
              <tbody>
                ${alerts.slice(0, 5).map(a => `
                  <tr>
                    <td>${a.created_at || "-"}</td>
                    <td>${a.alert_type}</td>
                    <td style="color:${a.severity === 'critical' ? 'var(--accent-red)' : a.severity === 'warning' ? 'var(--accent-orange)' : 'var(--accent-blue)'}">${a.severity}</td>
                    <td>${a.message}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : ""}

        <div class="report-section">
          <h4>${alerts.length > 0 ? "5" : "4"}. 위성별 NDVI 공간 분포</h4>
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">
            각 위성 소스별 최근 관측 데이터 기반 NDVI 분포 지도
          </div>
          <div id="reportNdviMaps" style="display:grid;grid-template-columns:1fr 1fr;gap:12px"></div>
        </div>

        <div class="report-section">
          <h4>${alerts.length > 0 ? "6" : "5"}. 권장 조치사항</h4>
          <div style="font-size:12px;line-height:1.8;color:var(--text-secondary)">
            ${getRecommendations(latest?.ndvi_mean, stats)}
          </div>
        </div>

        <div style="padding:16px;text-align:center;font-size:11px;color:var(--text-muted);border-top:1px solid var(--border-color)">
          Candori GreenSight | 위성 데이터: ESA Copernicus Sentinel-2 / NASA Landsat / MODIS | ${now}
        </div>
      </div>

      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary" onclick="window.print()">
          <span class="material-icons-outlined">print</span> 인쇄 / PDF 저장
        </button>
      </div>
    `;

    // Render report NDVI maps per satellite
    renderReportNDVIMaps(course, ndviData);
  } catch (err) {
    output.innerHTML = '<div style="color:var(--accent-red)">리포트 생성 실패</div>';
    console.error(err);
  }
}

function renderReportNDVIMaps(course, ndviData) {
  const container = document.getElementById("reportNdviMaps");
  if (!container) return;

  // Group by satellite
  const bySat = {};
  ndviData.forEach((r) => {
    if (!bySat[r.satellite]) bySat[r.satellite] = [];
    bySat[r.satellite].push(r);
  });

  const satNames = Object.keys(bySat);
  if (satNames.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);grid-column:span 2;text-align:center;padding:20px">데이터 없음</div>';
    return;
  }

  container.innerHTML = satNames.map((satName, idx) => `
    <div style="border:1px solid var(--border-color);border-radius:8px;overflow:hidden">
      <div style="padding:8px 12px;background:var(--bg-card);border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:600;font-size:12px">${satName}</span>
        <span style="font-size:10px;color:var(--text-muted)">${bySat[satName].length}회 관측</span>
      </div>
      <div id="reportMap_${idx}" style="height:260px"></div>
      <div style="padding:6px 12px;font-size:10px;display:flex;justify-content:space-between;color:var(--text-muted);border-top:1px solid var(--border-color)">
        <span>최근: ${bySat[satName].sort((a,b) => b.date.localeCompare(a.date))[0]?.date}</span>
        <span style="color:${getNDVIColor(bySat[satName][0]?.ndvi_mean)};font-weight:600">NDVI ${bySat[satName].sort((a,b) => b.date.localeCompare(a.date))[0]?.ndvi_mean?.toFixed(3)}</span>
      </div>
    </div>
  `).join("");

  // Create mini maps for each satellite
  setTimeout(() => {
    satNames.forEach((satName, idx) => {
      const mapEl = document.getElementById(`reportMap_${idx}`);
      if (!mapEl) return;

      const records = bySat[satName].sort((a, b) => b.date.localeCompare(a.date));
      const latest = records[0];

      const miniMap = L.map(mapEl, {
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: false,
      }).setView([course.lat, course.lng], 15);

      L.tileLayer("https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
        maxZoom: 21,
      }).addTo(miniMap);

      // Boundary (다중 폴리곤 지원)
      const miniPolys = parseBoundary(course.boundary);
      const miniAllCoords = getAllBoundaryCoords(course.boundary);
      miniPolys.forEach((p) => {
        if (p.coords && p.coords.length >= 3) {
          L.polygon(p.coords, {
            color: "#fff", weight: 2, fillColor: "transparent", fillOpacity: 0, dashArray: "6,4",
          }).addTo(miniMap);
        }
      });
      if (miniAllCoords.length >= 3) {
        miniMap.fitBounds(L.polygon(miniAllCoords).getBounds().pad(0.05));
      }

      // NDVI grid
      const cells = generateNDVIGrid(course, latest);
      cells.forEach((cell) => {
        L.rectangle(cell.bounds, {
          color: "transparent", weight: 0,
          fillColor: getNDVIColor(cell.ndvi),
          fillOpacity: 0.55,
        }).addTo(miniMap);
      });

      // Satellite label
      L.control.attribution({ prefix: false, position: "bottomleft" })
        .addAttribution(`<span style="color:#4ade80;font-weight:600">${satName}</span>`)
        .addTo(miniMap);
    });
  }, 300);
}

function getRecommendations(ndvi, stats) {
  if (!ndvi) return "데이터 부족으로 권장사항을 생성할 수 없습니다.";

  const items = [];
  if (ndvi < 0.3) {
    items.push("- NDVI가 매우 낮습니다. 긴급 현장 점검이 필요합니다.");
    items.push("- 관수 시스템 점검 및 긴급 관수를 권장합니다.");
    items.push("- 토양 수분 및 양분 상태 분석을 권장합니다.");
  } else if (ndvi < 0.5) {
    items.push("- 식생 상태가 보통 이하입니다. 정밀 점검을 권장합니다.");
    items.push("- 관수량 조정 및 비료 시비 계획을 재검토하세요.");
    items.push("- 병충해 가능성을 확인하세요.");
  } else if (ndvi < 0.65) {
    items.push("- 식생 상태가 양호합니다. 현재 관리 수준을 유지하세요.");
    items.push("- 계절 변화에 따른 관수량 조정을 참고하세요.");
  } else {
    items.push("- 식생 상태가 매우 건강합니다.");
    items.push("- 현재 관리 프로그램이 효과적으로 작동하고 있습니다.");
    items.push("- 정기적 모니터링을 계속 유지하세요.");
  }

  items.push("");
  items.push("* 위성 데이터 참고사항:");
  items.push("  - Planet NICFI: 4.77m 해상도, 월간 모자이크 (홀 단위 분석 가능)");
  items.push("  - Sentinel-2: 10m 해상도, 5일 주기 (페어웨이/그린 구분 가능)");
  items.push("  - HLS (Harmonized): 30m, Sentinel-2+Landsat 결합 2~3일 주기");
  items.push("  - Landsat 8/9: 30m 해상도, 16일 주기 (장기 시계열 분석)");
  items.push("  - VIIRS: 500m, MODIS 후속 센서 (광역 트렌드 파악)");
  items.push("  - MODIS: 250m~1km, 16일 합성 (API 키 불필요, 즉시 사용)");
  items.push("  - 구름 영향으로 실제 관측 빈도는 달라질 수 있습니다.");

  return items.join("<br>");
}

// ============ SATELLITE CATALOG ============

function updateSidebarSatInfo(satellites) {
  const countEl = document.getElementById("sidebarSatCount");
  const bestEl = document.getElementById("sidebarSatBest");
  const badgeEl = document.getElementById("satBadge");

  if (countEl) countEl.textContent = `${satellites.length}개 위성 연동`;
  if (badgeEl) badgeEl.textContent = satellites.length;

  const best = satellites.reduce(
    (min, s) => (s.resolution_m < min.resolution_m ? s : min),
    satellites[0]
  );
  if (bestEl && best) {
    bestEl.textContent = `최고 해상도: ${best.resolution} (${best.name.split(" ")[0]})`;
  }
}

function populateSatelliteSelectors(satellites) {
  const select = document.getElementById("satelliteSourceSelect");
  if (!select) return;

  // Keep the first "auto" option
  const first = select.options[0];
  select.innerHTML = "";
  select.appendChild(first);

  // Group by tier
  const tiers = { premium: "Premium", recommended: "Recommended", standard: "Standard", basic: "Basic" };
  const grouped = {};
  satellites.forEach((s) => {
    const tier = s.tier || "standard";
    if (!grouped[tier]) grouped[tier] = [];
    grouped[tier].push(s);
  });

  for (const [tier, sats] of Object.entries(grouped)) {
    const group = document.createElement("optgroup");
    group.label = `${tiers[tier] || tier} (${sats.length})`;
    sats.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.resolution})`;
      group.appendChild(opt);
    });
    select.appendChild(group);
  }
}

async function loadSatelliteCatalog() {
  const grid = document.getElementById("satellitesGrid");
  if (!grid) return;

  let satellites = state.satellites;
  if (!satellites.length) {
    try {
      satellites = await API.get("/api/ndvi/satellites");
      state.satellites = satellites;
    } catch (err) {
      grid.innerHTML = '<div class="loading" style="color:var(--accent-red)">위성 카탈로그 로드 실패</div>';
      return;
    }
  }

  renderSatelliteGrid(satellites);

  // Filter event
  const filter = document.getElementById("satFilterTier");
  if (filter) {
    filter.removeEventListener("change", handleSatFilter);
    filter.addEventListener("change", handleSatFilter);
  }
}

function handleSatFilter(e) {
  const tier = e.target.value;
  const filtered =
    tier === "all"
      ? state.satellites
      : state.satellites.filter((s) => s.tier === tier);
  renderSatelliteGrid(filtered);
}

function renderSatelliteGrid(satellites) {
  const grid = document.getElementById("satellitesGrid");
  if (!grid) return;

  grid.innerHTML = satellites
    .map((s) => {
      const resColor =
        s.resolution_m <= 5
          ? "var(--accent-orange)"
          : s.resolution_m <= 10
          ? "var(--accent-green)"
          : s.resolution_m <= 30
          ? "var(--accent-blue)"
          : "var(--text-muted)";

      const costClass = s.cost.includes("완전 무료") ? "free" : "freemium";

      return `
        <div class="card sat-card">
          <span class="sat-card-tier ${s.tier}">${
            s.tier === "premium" ? "PREMIUM" :
            s.tier === "recommended" ? "RECOMMENDED" :
            s.tier === "standard" ? "STANDARD" : "BASIC"
          }</span>

          <div class="sat-card-header">
            <div class="sat-card-name">${s.name}</div>
            <div class="sat-card-provider">${s.provider}</div>
          </div>

          <div class="sat-card-resolution" style="color:${resColor}">
            ${s.resolution}
            <span style="font-size:11px;font-weight:400;color:var(--text-muted);margin-left:4px">해상도</span>
          </div>

          <div class="sat-card-specs">
            <div><span class="sat-spec-label">재방문 주기</span></div>
            <div><span class="sat-spec-value">${s.revisit}</span></div>
            <div><span class="sat-spec-label">NIR 밴드</span></div>
            <div><span class="sat-spec-value">${s.bands_nir}</span></div>
            <div><span class="sat-spec-label">RED 밴드</span></div>
            <div><span class="sat-spec-value">${s.bands_red || "-"}</span></div>
            <div><span class="sat-spec-label">데이터 형식</span></div>
            <div><span class="sat-spec-value">${s.data_format}</span></div>
            <div><span class="sat-spec-label">인증 방식</span></div>
            <div class="sat-spec-value" style="grid-column:span 1">${s.auth}</div>
          </div>

          <div class="sat-card-ndvi">
            NDVI 산출식: <code>${s.ndvi_formula}</code>
          </div>

          <div class="sat-card-pros">+ ${s.pros}</div>
          <div class="sat-card-cons">- ${s.cons}</div>

          <span class="sat-card-cost ${costClass}">${s.cost}</span>
        </div>
      `;
    })
    .join("");
}

// ============ EDIT LOCATION (골프장 위치/영역 수정 - 다중 코스 지원) ============

let editMap = null;
let editMarker = null;
let editDrawnItems = null;
const POLY_COLORS = ["#4ade80", "#60a5fa", "#fb923c", "#a78bfa", "#f87171", "#2dd4bf", "#fbbf24", "#e879f9"];

window.openEditLocationModal = function (courseId) {
  const course = state.courses.find((c) => c.id === Number(courseId));
  if (!course) return;

  document.getElementById("editLocationModal").classList.add("active");
  document.getElementById("editLocationTitle").textContent = `${course.name} - 위치/영역 수정`;
  document.getElementById("editCourseId").value = courseId;
  document.getElementById("editName").value = course.name;
  document.getElementById("editLat").value = course.lat;
  document.getElementById("editLng").value = course.lng;
  document.getElementById("editAddress").value = course.address || "";

  setTimeout(() => initEditLocationMap(course), 200);
};

function initEditLocationMap(course) {
  if (editMap) { editMap.remove(); editMap = null; }

  editMap = L.map("editLocationMap", { zoomControl: true, attributionControl: false })
    .setView([course.lat, course.lng], 15);

  L.tileLayer("https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
    maxZoom: 21, attribution: "Google",
  }).addTo(editMap);

  // Draggable center marker
  editMarker = L.marker([course.lat, course.lng], {
    draggable: true,
    icon: L.divIcon({
      className: "",
      html: '<div style="width:24px;height:24px;border-radius:50%;background:#4ade80;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.5)"></div>',
      iconSize: [24, 24], iconAnchor: [12, 12],
    }),
  }).addTo(editMap);

  editMarker.on("dragend", function () {
    const pos = editMarker.getLatLng();
    document.getElementById("editLat").value = Math.round(pos.lat * 10000) / 10000;
    document.getElementById("editLng").value = Math.round(pos.lng * 10000) / 10000;
  });

  document.getElementById("editLat").addEventListener("change", syncMarkerFromInputs);
  document.getElementById("editLng").addEventListener("change", syncMarkerFromInputs);

  // Multi-polygon layer group
  editDrawnItems = new L.FeatureGroup();
  editMap.addLayer(editDrawnItems);

  // Load existing boundaries (다중 폴리곤 지원)
  const boundary = course.boundary || [];
  loadBoundariesToMap(boundary);

  // Draw controls - 여러 개 폴리곤 추가 가능 (clearLayers 하지 않음)
  const drawControl = new L.Control.Draw({
    position: "topleft",
    draw: {
      polygon: { allowIntersection: false, shapeOptions: { color: "#4ade80", weight: 2, fillOpacity: 0.15 } },
      rectangle: { shapeOptions: { color: "#4ade80", weight: 2, fillOpacity: 0.15 } },
      circle: false, circlemarker: false, marker: false, polyline: false,
    },
    edit: { featureGroup: editDrawnItems, remove: true, edit: true },
  });
  editMap.addControl(drawControl);

  // New polygon added (여러 개 추가 가능)
  editMap.on(L.Draw.Event.CREATED, function (e) {
    const layerCount = Object.keys(editDrawnItems._layers).length;
    const color = POLY_COLORS[layerCount % POLY_COLORS.length];
    e.layer.setStyle({ color, fillColor: color, fillOpacity: 0.15, weight: 2 });

    // 폴리곤에 코스 이름 라벨 + 클릭 삭제 추가
    const center = e.layer.getBounds().getCenter();
    const courseName = `코스 ${layerCount + 1}`;
    e.layer._courseName = courseName;
    e.layer._polyIndex = layerCount;
    e.layer.bindTooltip(courseName, { permanent: true, direction: "center", className: "poly-label" });

    // 클릭 → 삭제 팝업
    e.layer.on("click", function (ev) {
      L.DomEvent.stopPropagation(ev);
      const idx = getPolygonIndex(e.layer);
      const name = e.layer._courseName;
      const area = calculateArea(extractBoundaryCoords(e.layer));
      L.popup({ className: "edit-poly-popup", closeButton: true })
        .setLatLng(ev.latlng)
        .setContent(`
          <div style="font-size:12px;min-width:160px">
            <div style="font-weight:600;margin-bottom:6px;color:${color}">${name}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">면적: ${area} m²</div>
            <button onclick="removePolygonByLayer(this)" data-layer-id="${L.stamp(e.layer)}"
              style="width:100%;padding:6px;background:rgba(248,113,113,0.15);color:#f87171;border:1px solid rgba(248,113,113,0.3);border-radius:4px;cursor:pointer;font-size:11px;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:4px">
              <span class="material-icons-outlined" style="font-size:14px">delete</span>
              이 영역 삭제
            </button>
          </div>
        `)
        .openOn(editMap);
    });
    e.layer.on("mouseover", function () { e.layer.setStyle({ fillOpacity: 0.3, weight: 3 }); });
    e.layer.on("mouseout", function () { e.layer.setStyle({ fillOpacity: 0.15, weight: 2 }); });

    editDrawnItems.addLayer(e.layer);
    updateMultiBoundaryInfo();

    // 첫 폴리곤이면 마커도 이동
    if (layerCount === 0) {
      editMarker.setLatLng(center);
      document.getElementById("editLat").value = Math.round(center.lat * 10000) / 10000;
      document.getElementById("editLng").value = Math.round(center.lng * 10000) / 10000;
    }
  });

  editMap.on(L.Draw.Event.EDITED, function () { updateMultiBoundaryInfo(); });
  editMap.on(L.Draw.Event.DELETED, function () { updateMultiBoundaryInfo(); });
}

function loadBoundariesToMap(boundary) {
  if (!boundary || !editDrawnItems) return;

  // 다중 폴리곤 형식 감지
  // 형식 1 (기존): [[lat,lng], [lat,lng], ...] → 단일 폴리곤
  // 형식 2 (새): [{ name: "코스1", coords: [[lat,lng]...] }, ...] → 다중 폴리곤
  let polygons = [];

  if (boundary.length > 0 && Array.isArray(boundary[0]) && typeof boundary[0][0] === "number") {
    // 기존 단일 폴리곤
    polygons = [{ name: "코스 1", coords: boundary }];
  } else if (boundary.length > 0 && boundary[0].coords) {
    // 다중 폴리곤
    polygons = boundary;
  }

  const allBounds = [];
  polygons.forEach((poly, i) => {
    if (!poly.coords || poly.coords.length < 3) return;
    const color = POLY_COLORS[i % POLY_COLORS.length];
    const layer = L.polygon(poly.coords, { color, fillColor: color, fillOpacity: 0.15, weight: 2 });
    layer._courseName = poly.name || `코스 ${i + 1}`;
    layer._polyIndex = i;
    layer.bindTooltip(layer._courseName, { permanent: true, direction: "center", className: "poly-label" });

    // 폴리곤 클릭 → 삭제/이름변경 팝업
    layer.on("click", function (e) {
      L.DomEvent.stopPropagation(e);
      const idx = layer._polyIndex;
      const name = layer._courseName;
      const area = calculateArea(extractBoundaryCoords(layer));
      L.popup({ className: "edit-poly-popup", closeButton: true })
        .setLatLng(e.latlng)
        .setContent(`
          <div style="font-size:12px;min-width:160px">
            <div style="font-weight:600;margin-bottom:6px;color:${color}">${name}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">면적: ${area} m²</div>
            <button onclick="removePolygon(${idx}); this.closest('.leaflet-popup').remove();"
              style="width:100%;padding:6px;background:rgba(248,113,113,0.15);color:#f87171;border:1px solid rgba(248,113,113,0.3);border-radius:4px;cursor:pointer;font-size:11px;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:4px">
              <span class="material-icons-outlined" style="font-size:14px">delete</span>
              이 영역 삭제
            </button>
          </div>
        `)
        .openOn(editMap);
    });

    // 호버 효과
    layer.on("mouseover", function () { layer.setStyle({ fillOpacity: 0.3, weight: 3 }); });
    layer.on("mouseout", function () { layer.setStyle({ fillOpacity: 0.15, weight: 2 }); });

    editDrawnItems.addLayer(layer);
    allBounds.push(layer.getBounds());
  });

  if (allBounds.length > 0) {
    const combined = allBounds.reduce((acc, b) => acc.extend(b), L.latLngBounds(allBounds[0]));
    editMap.fitBounds(combined.pad(0.15));
  }

  updateMultiBoundaryInfo();
}

function updateMultiBoundaryInfo() {
  const infoEl = document.getElementById("editBoundaryInfo");
  const layers = [];
  if (editDrawnItems) {
    editDrawnItems.eachLayer((layer) => {
      const coords = extractBoundaryCoords(layer);
      layers.push({
        name: layer._courseName || `코스 ${layers.length + 1}`,
        coords,
        area: calculateArea(coords),
      });
    });
  }

  if (layers.length === 0) {
    infoEl.innerHTML = '<span style="color:var(--accent-orange)">영역 미설정 - 도구로 코스 영역을 그리세요</span>';
    document.getElementById("editBoundaryData").value = "[]";
    return;
  }

  const totalArea = layers.reduce((sum, l) => sum + parseInt(l.area.replace(/,/g, "")) || 0, 0);
  infoEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <span style="color:var(--accent-green)">${layers.length}개 코스 영역</span>
      <button onclick="clearAllBoundaries()" style="background:none;border:none;color:var(--accent-red);cursor:pointer;font-size:10px;font-family:inherit;padding:2px 4px;display:flex;align-items:center;gap:2px">
        <span class="material-icons-outlined" style="font-size:12px">delete_sweep</span>전체삭제
      </button>
    </div>
    ${layers.map((l, i) => `
      <div style="display:flex;align-items:center;gap:4px;padding:3px 0;border-bottom:1px solid var(--border-color)">
        <div style="width:8px;height:8px;border-radius:2px;background:${POLY_COLORS[i % POLY_COLORS.length]};flex-shrink:0"></div>
        <input type="text" value="${l.name}" style="flex:1;background:transparent;border:none;color:var(--text-primary);font-size:10px;padding:2px;outline:none;min-width:0" onchange="renamePolygon(${i}, this.value)">
        <span style="font-size:9px;color:var(--text-muted);white-space:nowrap">${l.area}m&sup2;</span>
        <button onclick="removePolygon(${i})" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:0;display:flex;align-items:center;flex-shrink:0" title="이 영역 삭제">
          <span class="material-icons-outlined" style="font-size:14px">close</span>
        </button>
      </div>
    `).join("")}
    <div style="margin-top:4px;font-size:9px;color:var(--text-muted)">총 면적: ~${totalArea.toLocaleString()} m&sup2;</div>
  `;

  // 다중 폴리곤 형식으로 저장
  const boundaryData = layers.map((l) => ({ name: l.name, coords: l.coords }));
  document.getElementById("editBoundaryData").value = JSON.stringify(boundaryData);
}

window.renamePolygon = function (index, newName) {
  let i = 0;
  editDrawnItems.eachLayer((layer) => {
    if (i === index) {
      layer._courseName = newName;
      layer.setTooltipContent(newName);
    }
    i++;
  });
  updateMultiBoundaryInfo();
};

window.removePolygon = function (index) {
  if (!editDrawnItems) return;
  let i = 0;
  let target = null;
  editDrawnItems.eachLayer((layer) => {
    if (i === index) target = layer;
    i++;
  });
  if (target) {
    editDrawnItems.removeLayer(target);
    if (editMap) editMap.closePopup();
    updateMultiBoundaryInfo();
  }
};

window.removePolygonByLayer = function (btnEl) {
  if (!editDrawnItems) return;
  const layerId = parseInt(btnEl.dataset.layerId);
  editDrawnItems.eachLayer((layer) => {
    if (L.stamp(layer) === layerId) {
      editDrawnItems.removeLayer(layer);
    }
  });
  if (editMap) editMap.closePopup();
  updateMultiBoundaryInfo();
};

function getPolygonIndex(targetLayer) {
  let idx = 0;
  editDrawnItems.eachLayer((layer) => {
    if (layer === targetLayer) return;
    idx++;
  });
  return idx;
}

window.clearAllBoundaries = function () {
  if (!editDrawnItems) return;
  if (!confirm("모든 영역을 삭제하시겠습니까?")) return;
  editDrawnItems.clearLayers();
  updateMultiBoundaryInfo();
};

function syncMarkerFromInputs() {
  const lat = parseFloat(document.getElementById("editLat").value);
  const lng = parseFloat(document.getElementById("editLng").value);
  if (!isNaN(lat) && !isNaN(lng) && editMarker && editMap) {
    editMarker.setLatLng([lat, lng]);
    editMap.panTo([lat, lng]);
  }
}

function extractBoundaryCoords(layer) {
  const latlngs = layer.getLatLngs();
  const ring = latlngs[0] || latlngs;
  return ring.map((p) => [Math.round(p.lat * 10000) / 10000, Math.round(p.lng * 10000) / 10000]);
}

window.saveEditedLocation = async function () {
  const courseId = document.getElementById("editCourseId").value;
  const lat = parseFloat(document.getElementById("editLat").value);
  const lng = parseFloat(document.getElementById("editLng").value);
  const name = document.getElementById("editName").value;
  const address = document.getElementById("editAddress").value;

  let boundary;
  try {
    boundary = JSON.parse(document.getElementById("editBoundaryData").value || "[]");
  } catch (_) {
    boundary = [];
  }

  try {
    await API.put(`/api/golf-courses/${courseId}`, { name, lat, lng, address, boundary });
    showToast(`"${name}" 위치/영역 저장 완료 (${Array.isArray(boundary) ? boundary.length : 0}개 코스)`);
    closeEditLocationModal();
    loadData();
  } catch (err) {
    alert("저장 실패: " + err.message);
  }
};

window.closeEditLocationModal = function () {
  document.getElementById("editLocationModal").classList.remove("active");
  const win = document.getElementById("editLocationWindow");
  if (win) {
    win.classList.remove("is-dragged", "is-fullscreen");
    win.style.top = "50%";
    win.style.left = "50%";
    win.style.width = "950px";
    win.style.height = "580px";
    win.style.transform = "translate(-50%, -50%)";
    document.getElementById("editFullscreenIcon").textContent = "fullscreen";
  }
  if (editMap) { editMap.remove(); editMap = null; editMarker = null; editDrawnItems = null; }
};

window.toggleEditLocationFullscreen = function () {
  const win = document.getElementById("editLocationWindow");
  const icon = document.getElementById("editFullscreenIcon");
  if (win.classList.contains("is-fullscreen")) {
    win.classList.remove("is-fullscreen");
    icon.textContent = "fullscreen";
  } else {
    win.classList.add("is-fullscreen", "is-dragged");
    icon.textContent = "fullscreen_exit";
  }
  if (editMap) setTimeout(() => editMap.invalidateSize(), 100);
};

// ── Drag & Resize for edit location window (8방향) ────────
(function () {
  let mode = null; // "drag" | "resize"
  let resizeDir = "";
  let startX, startY, startLeft, startTop, startW, startH;
  const MIN_W = 600, MIN_H = 400;

  function snapToPixels(win) {
    win.classList.add("is-dragged");
    win.style.transform = "none";
    const rect = win.getBoundingClientRect();
    win.style.left = rect.left + "px";
    win.style.top = rect.top + "px";
    win.style.width = rect.width + "px";
    win.style.height = rect.height + "px";
    return rect;
  }

  document.addEventListener("mousedown", function (e) {
    const win = document.getElementById("editLocationWindow");
    if (!win || !win.closest(".modal.active") || win.classList.contains("is-fullscreen")) return;

    const dragbar = e.target.closest("#editLocationDragbar");
    const resizeEdge = e.target.closest(".resize-edge");

    if (dragbar && !e.target.closest("button")) {
      mode = "drag";
      const rect = snapToPixels(win);
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      e.preventDefault();
    }

    if (resizeEdge) {
      mode = "resize";
      resizeDir = resizeEdge.dataset.dir;
      const rect = snapToPixels(win);
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      startW = rect.width; startH = rect.height;
      e.preventDefault();
    }
  });

  document.addEventListener("mousemove", function (e) {
    if (!mode) return;
    const win = document.getElementById("editLocationWindow");
    if (!win) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (mode === "drag") {
      win.style.left = (startLeft + dx) + "px";
      win.style.top = (startTop + dy) + "px";
      return;
    }

    if (mode === "resize") {
      let newW = startW, newH = startH, newL = startLeft, newT = startTop;

      if (resizeDir.includes("e")) newW = Math.max(MIN_W, startW + dx);
      if (resizeDir.includes("s")) newH = Math.max(MIN_H, startH + dy);
      if (resizeDir.includes("w")) {
        const dw = Math.min(dx, startW - MIN_W);
        newW = startW - dw; newL = startLeft + dw;
      }
      if (resizeDir.includes("n")) {
        const dh = Math.min(dy, startH - MIN_H);
        newH = startH - dh; newT = startTop + dh;
      }

      win.style.width = newW + "px";
      win.style.height = newH + "px";
      win.style.left = newL + "px";
      win.style.top = newT + "px";
    }
  });

  document.addEventListener("mouseup", function () {
    if (mode) {
      mode = null;
      resizeDir = "";
      if (editMap) setTimeout(() => editMap.invalidateSize(), 50);
    }
  });
})();

window.deleteCourse = async function (courseId, courseName) {
  if (!confirm(`"${courseName}"을(를) 삭제하시겠습니까?\n관련 NDVI 데이터도 모두 삭제됩니다.`)) return;
  try {
    await API.delete(`/api/golf-courses/${courseId}`);
    showToast(`"${courseName}" 삭제 완료`);
    loadData();
  } catch (err) {
    alert("삭제 실패: " + err.message);
  }
};

// ============ MAP DRAWING (골프장 영역 마킹) ============

let drawMap = null;
let drawnItems = null;

function initDrawMap() {
  if (drawMap) {
    drawMap.invalidateSize();
    return;
  }

  drawMap = L.map("drawMap", {
    zoomControl: true,
    attributionControl: false,
  }).setView([37.5, 127.5], 8);

  // Google Hybrid as default for drawing (easy to see golf courses)
  L.tileLayer("https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
    maxZoom: 21,
    attribution: "Google",
  }).addTo(drawMap);

  // Drawn items layer
  drawnItems = new L.FeatureGroup();
  drawMap.addLayer(drawnItems);

  // Draw controls
  const drawControl = new L.Control.Draw({
    position: "topleft",
    draw: {
      polygon: {
        allowIntersection: false,
        shapeOptions: {
          color: "#4ade80",
          weight: 3,
          fillOpacity: 0.2,
          fillColor: "#4ade80",
        },
      },
      rectangle: {
        shapeOptions: {
          color: "#4ade80",
          weight: 3,
          fillOpacity: 0.2,
          fillColor: "#4ade80",
        },
      },
      circle: false,
      circlemarker: false,
      marker: false,
      polyline: false,
    },
    edit: {
      featureGroup: drawnItems,
      remove: true,
    },
  });
  drawMap.addControl(drawControl);

  // Handle draw created - 다중 코스 추가 가능
  drawMap.on(L.Draw.Event.CREATED, function (e) {
    const layerCount = Object.keys(drawnItems._layers).length;
    const color = POLY_COLORS[layerCount % POLY_COLORS.length];
    e.layer.setStyle({ color, fillColor: color, fillOpacity: 0.15, weight: 2 });

    const courseName = `코스 ${layerCount + 1}`;
    e.layer._courseName = courseName;
    e.layer.bindTooltip(courseName, { permanent: true, direction: "center", className: "poly-label" });

    drawnItems.addLayer(e.layer);

    // 전체 영역의 중심 계산
    const allBounds = L.latLngBounds([]);
    drawnItems.eachLayer((l) => allBounds.extend(l.getBounds()));
    const center = allBounds.getCenter();

    document.getElementById("drawLat").value = Math.round(center.lat * 10000) / 10000;
    document.getElementById("drawLng").value = Math.round(center.lng * 10000) / 10000;

    // 다중 폴리곤 형식으로 저장
    const polygons = [];
    drawnItems.eachLayer((l) => {
      const coords = extractBoundaryCoords(l);
      polygons.push({ name: l._courseName || `코스 ${polygons.length + 1}`, coords });
    });
    document.getElementById("drawBoundary").value = JSON.stringify(polygons);

    const totalArea = polygons.reduce((sum, p) => sum + parseInt(calculateArea(p.coords).replace(/,/g, "")) || 0, 0);
    document.getElementById("drawInfo").innerHTML = `
      <div style="color:var(--accent-green);margin-bottom:4px">${polygons.length}개 코스 영역</div>
      ${polygons.map((p, i) => `
        <div style="display:flex;align-items:center;gap:4px;padding:2px 0">
          <div style="width:8px;height:8px;border-radius:2px;background:${POLY_COLORS[i % POLY_COLORS.length]}"></div>
          <span style="font-size:10px">${p.name}</span>
          <span style="font-size:9px;color:var(--text-muted);margin-left:auto">${calculateArea(p.coords)}m&sup2;</span>
        </div>
      `).join("")}
      <div style="margin-top:4px;font-size:9px;color:var(--text-muted)">총 면적: ~${totalArea.toLocaleString()} m&sup2;</div>
      <div style="margin-top:4px;color:var(--accent-blue);font-size:9px">다른 코스를 추가로 그릴 수 있습니다</div>
    `;

    document.getElementById("submitCourseBtn").disabled = false;
  });

  // Handle draw deleted
  drawMap.on(L.Draw.Event.DELETED, function () {
    const remaining = Object.keys(drawnItems._layers).length;
    if (remaining === 0) {
      document.getElementById("drawLat").value = "";
      document.getElementById("drawLng").value = "";
      document.getElementById("drawBoundary").value = "";
      document.getElementById("drawInfo").innerHTML = '<span style="color:var(--text-muted)">영역을 그려주세요</span>';
      document.getElementById("submitCourseBtn").disabled = true;
    }
  });

  // Add existing courses as reference markers
  state.courses.forEach((c) => {
    L.circleMarker([c.lat, c.lng], {
      radius: 6,
      fillColor: getNDVIColor(c.latest_ndvi),
      fillOpacity: 0.6,
      color: "#fff",
      weight: 1,
    })
      .bindTooltip(c.name, { permanent: false, direction: "top" })
      .addTo(drawMap);

    const refBounds = parseBoundary(c.boundary);
    refBounds.forEach((p) => {
      if (p.coords && p.coords.length >= 3) {
        L.polygon(p.coords, {
          color: getNDVIColor(c.latest_ndvi), weight: 1, fillOpacity: 0.08, dashArray: "4,4",
        }).addTo(drawMap);
      }
    });
  });
}

function cleanupDrawMap() {
  if (drawMap) {
    drawMap.remove();
    drawMap = null;
    drawnItems = null;
  }
  // Reset form state
  document.getElementById("drawLat").value = "";
  document.getElementById("drawLng").value = "";
  document.getElementById("drawBoundary").value = "";
  document.getElementById("drawInfo").innerHTML = '<span style="color:var(--text-muted)">영역을 그려주세요</span>';
  document.getElementById("submitCourseBtn").disabled = true;
}

function calculateArea(coords) {
  // Shoelace formula approximation in sq meters
  if (coords.length < 3) return 0;
  let area = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += coords[i][1] * coords[j][0];
    area -= coords[j][1] * coords[i][0];
  }
  area = Math.abs(area) / 2;
  // Convert degrees^2 to approx m^2 (1 degree ≈ 111km at this latitude)
  const latScale = 111320;
  const lngScale = 111320 * Math.cos((coords[0][0] * Math.PI) / 180);
  const areaSqm = Math.round(area * latScale * lngScale);
  return areaSqm.toLocaleString();
}

// ============ EVENT LISTENERS ============
function initEventListeners() {
  // Trend chart course selector
  document.getElementById("trendCourseSelect").addEventListener("change", (e) => {
    loadTrendChart(e.target.value);
  });

  // Refresh button
  document.getElementById("refreshBtn").addEventListener("click", () => {
    loadData();
  });

  // Map layer switcher (dashboard)
  document.getElementById("mapLayerSelect").addEventListener("change", (e) => {
    switchMapLayer(state.dashboardMap, e.target.value);
  });

  // Analysis course selector
  document.getElementById("analysisCourseSelect").addEventListener("change", (e) => {
    if (e.target.value) loadAnalysis(e.target.value);
  });

  // Analysis period
  document.getElementById("analysisPeriod").addEventListener("change", () => {
    const courseId = document.getElementById("analysisCourseSelect").value;
    if (courseId) loadAnalysis(courseId);
  });

  // Compare button
  document.getElementById("compareBtn").addEventListener("click", loadCompare);

  // Alert filter
  document.getElementById("alertFilter").addEventListener("change", loadAlerts);

  // Add course - open modal and init draw map
  document.getElementById("addCourseBtn").addEventListener("click", () => {
    document.getElementById("addCourseModal").classList.add("active");
    setTimeout(() => initDrawMap(), 200);
  });

  document.querySelectorAll(".modal-close").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".modal").classList.remove("active");
      cleanupDrawMap();
    });
  });

  document.getElementById("addCourseForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    data.lat = parseFloat(data.lat);
    data.lng = parseFloat(data.lng);
    data.holes = parseInt(data.holes) || 18;

    // Parse boundary from hidden field
    try {
      data.boundary = JSON.parse(data.boundary || "[]");
    } catch (_) {
      data.boundary = [];
    }

    // Show loading on submit button
    const submitBtn = document.getElementById("submitCourseBtn");
    const origText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;margin-right:6px"></div> 1년치 NDVI 생성 중...';
    submitBtn.disabled = true;

    try {
      const result = await API.post("/api/golf-courses", data);
      document.getElementById("addCourseModal").classList.remove("active");
      e.target.reset();
      cleanupDrawMap();
      submitBtn.innerHTML = origText;
      submitBtn.disabled = true; // stays disabled until next draw

      // Reload data
      await loadData();

      // Auto-navigate to analysis view for the new course
      const newId = result.id;
      if (newId) {
        state.selectedCourse = state.courses.find((c) => c.id === Number(newId));
        switchView("analysis");
        document.getElementById("analysisCourseSelect").value = newId;
        document.getElementById("analysisPeriod").value = "365";
        loadAnalysis(newId);
      }

      // Notification
      const msg = `"${data.name}" 추가 완료! ${result.ndvi_records_generated || 0}건의 NDVI 데이터(${result.ndvi_period || "1년"})가 생성되었습니다.`;
      showToast(msg);
    } catch (err) {
      submitBtn.innerHTML = origText;
      submitBtn.disabled = false;
      alert("골프장 추가 실패: " + err.message);
    }
  });

  // Notification button
  document.getElementById("notifBtn").addEventListener("click", () => {
    switchView("alerts");
  });

  // Report generation
  document.getElementById("generateReportBtn").addEventListener("click", generateReport);
}
