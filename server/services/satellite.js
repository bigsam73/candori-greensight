/**
 * Satellite Data Service
 * ─────────────────────────────────────────────────────────────────
 * 공개 / 무료 위성 데이터 소스 (NDVI 해상도 순 정렬)
 *
 * ┌─────────────────────┬─────────┬─────────┬───────────┬──────────────────────────────────────────────────┐
 * │ 위성                │ 해상도  │ 주기    │ NDVI 밴드 │ 접근 방법                                        │
 * ├─────────────────────┼─────────┼─────────┼───────────┼──────────────────────────────────────────────────┤
 * │ Planet NICFI        │   4.77m │ 월 1회  │ NIR+Red   │ planet.com (열대/비열대 전용, 무료 등록)          │
 * │ NAIP (미국)         │   0.6m  │ 2~3년   │ NIR+Red   │ USGS(미국 전용, 참고용)                           │
 * │ Sentinel-2 L2A      │  10m    │ 5일     │ B08+B04   │ Copernicus Data Space (완전 무료)                 │
 * │ HLS (Harmonized)    │  30m    │ 2~3일   │ B05+B04   │ NASA LP DAAC (무료, Earthdata Login)              │
 * │ Landsat 8/9 OLI     │  30m    │ 16일    │ B5+B4     │ USGS Earth Explorer (완전 무료)                   │
 * │ VIIRS VNP13A1       │ 500m    │ 16일    │ NDVI직접  │ NASA LP DAAC (무료)                               │
 * │ MODIS MOD13Q1       │ 250m    │ 16일    │ NDVI직접  │ NASA MODIS Web Service (완전 무료, 키 불필요)      │
 * │ MODIS MOD13A1       │ 500m    │ 16일    │ NDVI직접  │ NASA MODIS Web Service                            │
 * │ MODIS MOD13A2       │  1km    │ 16일    │ NDVI직접  │ NASA AppEEARS (무료)                              │
 * └─────────────────────┴─────────┴─────────┴───────────┴──────────────────────────────────────────────────┘
 *
 * NDVI = (NIR - RED) / (NIR + RED)
 * ─────────────────────────────────────────────────────────────────
 */
const axios = require("axios");
const db = require("./database");

// ─── 위성 카탈로그 (해상도 좋은 순) ───────────────────────────────
const SATELLITE_CATALOG = [
  {
    id: "planet-nicfi",
    name: "Planet NICFI Basemaps",
    provider: "Planet Labs / NICFI (Norway)",
    resolution: "4.77m",
    resolution_m: 4.77,
    revisit: "월 1회 모자이크",
    bands_nir: "NIR (Band 4)",
    bands_red: "Red (Band 3)",
    ndvi_formula: "(B4 - B3) / (B4 + B3)",
    coverage: "열대·아열대 중심, 전 세계 육지",
    cost: "무료 (비상업 연구·비영리 목적, planet.com 가입)",
    api_url: "https://api.planet.com/basemaps/v1/mosaics",
    auth: "API Key (planet.com 무료 가입 후 발급)",
    env_key: "PLANET_API_KEY",
    data_format: "GeoTIFF (COG)",
    pros: "골프장 홀 단위까지 식별 가능한 초고해상도",
    cons: "월 1회 모자이크만 무료, 일일 영상은 유료",
    evalscript: null,
    enabled: true,
    tier: "premium",
  },
  {
    id: "sentinel-2",
    name: "Sentinel-2 L2A (MSI)",
    provider: "ESA Copernicus",
    resolution: "10m",
    resolution_m: 10,
    revisit: "5일",
    bands_nir: "B08 (842nm)",
    bands_red: "B04 (665nm)",
    ndvi_formula: "(B08 - B04) / (B08 + B04)",
    coverage: "전 세계 육지",
    cost: "완전 무료",
    api_url: "https://catalogue.dataspace.copernicus.eu/odata/v1",
    processing_url: "https://services.sentinel-hub.com/api/v1/process",
    auth: "Copernicus Data Space: 무료 가입 / Sentinel Hub: OAuth2 (월 30,000 무료 요청)",
    env_key: "SENTINEL_HUB_CLIENT_ID, SENTINEL_HUB_CLIENT_SECRET",
    data_format: "JP2 / GeoTIFF",
    pros: "NDVI용 최적 무료 위성. 10m에서 페어웨이/그린 구분 가능. 5일 주기로 빈번한 갱신",
    cons: "구름 영향, 야간 촬영 불가",
    enabled: true,
    tier: "recommended",
  },
  {
    id: "hls",
    name: "HLS (Harmonized Landsat Sentinel-2)",
    provider: "NASA LP DAAC",
    resolution: "30m",
    resolution_m: 30,
    revisit: "2~3일 (Sentinel-2 + Landsat 결합)",
    bands_nir: "B05 (HLS-S) / B05 (HLS-L)",
    bands_red: "B04",
    ndvi_formula: "(B05 - B04) / (B05 + B04)",
    coverage: "전 세계 육지",
    cost: "완전 무료 (NASA Earthdata Login 필요)",
    api_url: "https://cmr.earthdata.nasa.gov/search/granules.json",
    stac_url: "https://cmr.earthdata.nasa.gov/stac/LPCLOUD",
    auth: "NASA Earthdata Login (무료 가입)",
    env_key: "EARTHDATA_LOGIN, EARTHDATA_PASSWORD",
    data_format: "COG (Cloud-Optimized GeoTIFF)",
    pros: "Sentinel-2 + Landsat을 하나로 통합해 2~3일 주기 확보. 대기보정 완료. 시계열 일관성 우수",
    cons: "30m 해상도로 그린 단위 분석은 한계",
    enabled: true,
    tier: "recommended",
  },
  {
    id: "landsat-8",
    name: "Landsat 8 OLI",
    provider: "NASA / USGS",
    resolution: "30m",
    resolution_m: 30,
    revisit: "16일",
    bands_nir: "B5 (865nm)",
    bands_red: "B4 (655nm)",
    ndvi_formula: "(B5 - B4) / (B5 + B4)",
    coverage: "전 세계 육지",
    cost: "완전 무료",
    api_url: "https://m2m.cr.usgs.gov/api/api/json/stable",
    stac_url: "https://landsatlook.usgs.gov/stac-server",
    auth: "USGS Earth Explorer 계정 (무료 가입)",
    env_key: "USGS_USERNAME, USGS_PASSWORD",
    data_format: "GeoTIFF",
    pros: "1984년부터 이어진 장기 시계열 데이터. 안정적이고 검증된 품질",
    cons: "16일 주기, 30m 해상도",
    enabled: true,
    tier: "standard",
  },
  {
    id: "landsat-9",
    name: "Landsat 9 OLI-2",
    provider: "NASA / USGS",
    resolution: "30m",
    resolution_m: 30,
    revisit: "16일 (Landsat 8과 8일 간격)",
    bands_nir: "B5 (865nm)",
    bands_red: "B4 (655nm)",
    ndvi_formula: "(B5 - B4) / (B5 + B4)",
    coverage: "전 세계 육지",
    cost: "완전 무료",
    api_url: "https://m2m.cr.usgs.gov/api/api/json/stable",
    stac_url: "https://landsatlook.usgs.gov/stac-server",
    auth: "USGS Earth Explorer 계정 (무료 가입)",
    env_key: "USGS_USERNAME, USGS_PASSWORD",
    data_format: "GeoTIFF",
    pros: "Landsat 8 후속기. 8과 교차 운용 시 8일 주기. 향상된 radiometric 정밀도",
    cons: "16일 주기 단독, 30m 해상도",
    enabled: true,
    tier: "standard",
  },
  {
    id: "viirs",
    name: "VIIRS VNP13A1 (NDVI)",
    provider: "NASA LP DAAC (Suomi NPP / NOAA-20)",
    resolution: "500m",
    resolution_m: 500,
    revisit: "16일 합성",
    bands_nir: "NDVI 직접 제공 (I2 + I1 밴드 기반)",
    bands_red: "-",
    ndvi_formula: "제품에 NDVI 값 포함",
    coverage: "전 세계",
    cost: "완전 무료",
    api_url: "https://cmr.earthdata.nasa.gov/search/granules.json",
    appeears_url: "https://appeears.earthdatacloud.nasa.gov/api",
    auth: "NASA Earthdata Login (무료 가입)",
    env_key: "EARTHDATA_LOGIN, EARTHDATA_PASSWORD",
    data_format: "HDF5 / GeoTIFF",
    pros: "MODIS 후속 센서. 개선된 보정 품질. 500m에서 골프장 전체 트렌드 파악 가능",
    cons: "골프장 내부 세부 구역 식별 불가",
    enabled: true,
    tier: "standard",
  },
  {
    id: "modis-250m",
    name: "MODIS MOD13Q1 (250m NDVI)",
    provider: "NASA",
    resolution: "250m",
    resolution_m: 250,
    revisit: "16일 합성",
    bands_nir: "NDVI 직접 제공 (Band 2 + Band 1)",
    bands_red: "-",
    ndvi_formula: "제품에 NDVI 값 포함",
    coverage: "전 세계",
    cost: "완전 무료 (API 키 불필요)",
    api_url: "https://modis.ornl.gov/rst/api/v1",
    auth: "불필요 (공개 API)",
    env_key: null,
    data_format: "JSON / GeoTIFF",
    pros: "가장 접근이 쉬움. API 키 없이 바로 사용 가능. 20년+ 시계열",
    cons: "250m로 골프장 내부 구역 구분 어려움",
    enabled: true,
    tier: "standard",
  },
  {
    id: "modis-500m",
    name: "MODIS MOD13A1 (500m NDVI)",
    provider: "NASA",
    resolution: "500m",
    resolution_m: 500,
    revisit: "16일 합성",
    bands_nir: "NDVI 직접 제공",
    bands_red: "-",
    ndvi_formula: "제품에 NDVI 값 포함",
    coverage: "전 세계",
    cost: "완전 무료",
    api_url: "https://modis.ornl.gov/rst/api/v1",
    auth: "불필요 (공개 API)",
    env_key: null,
    data_format: "JSON / GeoTIFF",
    pros: "추가 QA 밴드 포함. 구름·그림자 마스킹 우수",
    cons: "500m 해상도",
    enabled: true,
    tier: "standard",
  },
  {
    id: "modis-1km",
    name: "MODIS MOD13A2 (1km NDVI)",
    provider: "NASA",
    resolution: "1km",
    resolution_m: 1000,
    revisit: "16일 합성",
    bands_nir: "NDVI 직접 제공",
    bands_red: "-",
    ndvi_formula: "제품에 NDVI 값 포함",
    coverage: "전 세계",
    cost: "완전 무료",
    api_url: "https://appeears.earthdatacloud.nasa.gov/api",
    auth: "NASA Earthdata Login (무료 가입)",
    env_key: "EARTHDATA_LOGIN, EARTHDATA_PASSWORD",
    data_format: "HDF4 / GeoTIFF",
    pros: "광역 모니터링에 적합. 장기 기후 트렌드 분석",
    cons: "1km 해상도로 개별 골프장 분석에는 부적합",
    enabled: true,
    tier: "basic",
  },
];

// ─── Evalscripts ─────────────────────────────────────────────────

// Sentinel-2 NDVI Evalscript (Sentinel Hub Processing API)
const SENTINEL2_NDVI_EVALSCRIPT = `
//VERSION=3
function setup() {
  return {
    input: [{
      bands: ["B04", "B08", "SCL"],
      units: "DN"
    }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndvi_color", bands: 3, sampleType: "AUTO" }
    ]
  };
}

function evaluatePixel(sample) {
  // SCL cloud masking: 3=cloud shadow, 8=cloud medium, 9=cloud high, 10=cirrus
  if ([3, 8, 9, 10].includes(sample.SCL)) {
    return { ndvi: [-9999], ndvi_color: [200, 200, 200] };
  }

  let ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04);

  let r, g, b;
  if (ndvi < -0.1)      { r = 120; g = 120; b = 120; }  // 비식생 (물, 인공물)
  else if (ndvi < 0.0)  { r = 160; g = 100; b =  80; }  // 나지
  else if (ndvi < 0.15) { r = 200; g = 130; b =  80; }  // 매우 약한 식생
  else if (ndvi < 0.25) { r = 210; g = 170; b =  60; }  // 스트레스 식생
  else if (ndvi < 0.35) { r = 220; g = 210; b =  50; }  // 약한 식생
  else if (ndvi < 0.45) { r = 180; g = 210; b =  50; }  // 보통 식생
  else if (ndvi < 0.55) { r = 130; g = 200; b =  60; }  // 양호한 식생
  else if (ndvi < 0.65) { r =  80; g = 180; b =  50; }  // 좋은 식생
  else if (ndvi < 0.75) { r =  40; g = 150; b =  30; }  // 건강한 식생
  else                  { r =  10; g = 110; b =  10; }  // 매우 건강한 식생

  return {
    ndvi: [ndvi],
    ndvi_color: [r, g, b]
  };
}
`;

// Landsat 8/9 NDVI Evalscript
const LANDSAT_NDVI_EVALSCRIPT = `
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B05", "BQA"] }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndvi_color", bands: 3, sampleType: "AUTO" }
    ]
  };
}

function evaluatePixel(sample) {
  let ndvi = (sample.B05 - sample.B04) / (sample.B05 + sample.B04);
  let r, g, b;
  if (ndvi < 0.0)       { r = 160; g = 100; b =  80; }
  else if (ndvi < 0.2)  { r = 210; g = 170; b =  60; }
  else if (ndvi < 0.4)  { r = 220; g = 210; b =  50; }
  else if (ndvi < 0.6)  { r = 130; g = 200; b =  60; }
  else if (ndvi < 0.8)  { r =  40; g = 150; b =  30; }
  else                  { r =  10; g = 110; b =  10; }
  return { ndvi: [ndvi], ndvi_color: [r, g, b] };
}
`;

// ─── API Endpoints ───────────────────────────────────────────────

const CDSE_API_URL = "https://catalogue.dataspace.copernicus.eu/odata/v1";
const MODIS_API_URL = "https://modis.ornl.gov/rst/api/v1";
const EARTHDATA_CMR_URL = "https://cmr.earthdata.nasa.gov/search";
const APPEEARS_URL = "https://appeears.earthdatacloud.nasa.gov/api";
const USGS_M2M_URL = "https://m2m.cr.usgs.gov/api/api/json/stable";
const PLANET_API_URL = "https://api.planet.com/basemaps/v1/mosaics";

// ─── Service Class ───────────────────────────────────────────────

class SatelliteService {
  constructor() {
    this.sentinelHubToken = null;
    this.tokenExpiry = null;
  }

  // ════════════════════════════════════════════════════════════════
  //  카탈로그 조회
  // ════════════════════════════════════════════════════════════════

  /** 전체 위성 카탈로그 반환 */
  getCatalog() {
    return SATELLITE_CATALOG;
  }

  /** 활성화된 위성만 반환 */
  getEnabledSatellites() {
    return SATELLITE_CATALOG.filter((s) => s.enabled);
  }

  /** 해상도 기준 추천 위성 반환 (골프장 NDVI 분석용) */
  getRecommended() {
    return SATELLITE_CATALOG.filter(
      (s) => s.enabled && (s.tier === "recommended" || s.tier === "premium")
    );
  }

  // ════════════════════════════════════════════════════════════════
  //  1. Planet NICFI (4.77m) - 최고 해상도 무료 위성
  // ════════════════════════════════════════════════════════════════

  /**
   * Planet NICFI 모자이크 검색
   * 무료: 비상업/연구 목적 가입 시 전 세계 4.77m 월간 모자이크
   * 등록: planet.com/nicfi → API Key 발급
   */
  async searchPlanetNICFI(bbox, dateFrom, dateTo) {
    const apiKey = process.env.PLANET_API_KEY;
    if (!apiKey) {
      console.log("[Planet] API Key 없음 - planet.com/nicfi 가입 필요");
      return [];
    }

    try {
      const response = await axios.get(PLANET_API_URL, {
        params: { name__contains: "planet_medres_normalized_analytic" },
        auth: { username: apiKey, password: "" },
        timeout: 15000,
      });

      const mosaics = response.data.mosaics || [];
      return mosaics
        .filter((m) => {
          const d = m.first_acquired?.split("T")[0];
          return d && d >= dateFrom && d <= dateTo;
        })
        .map((m) => ({
          id: m.id,
          name: m.name,
          date: m.first_acquired,
          satellite: "Planet NICFI",
          resolution: "4.77m",
          quad_url: m._links?.quads,
        }));
    } catch (err) {
      console.error("[Planet NICFI] 검색 실패:", err.message);
      return [];
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  2. Sentinel-2 (10m) - NDVI 최적 무료 위성
  // ════════════════════════════════════════════════════════════════

  /**
   * Copernicus Data Space Ecosystem에서 Sentinel-2 검색 (완전 무료)
   */
  async searchSentinel2(bbox, dateFrom, dateTo) {
    const [west, south, east, north] = bbox;
    const filter = [
      `Collection/Name eq 'SENTINEL-2'`,
      `OData.CSC.Intersects(area=geography'SRID=4326;POLYGON((${west} ${south},${east} ${south},${east} ${north},${west} ${north},${west} ${south}))')`,
      `ContentDate/Start gt ${dateFrom}T00:00:00.000Z`,
      `ContentDate/Start lt ${dateTo}T23:59:59.999Z`,
      `Attributes/OData.CSC.DoubleAttribute/any(att:att/Name eq 'cloudCover' and att/OData.CSC.DoubleAttribute/Value lt 30)`,
    ].join(" and ");

    try {
      const response = await axios.get(`${CDSE_API_URL}/Products`, {
        params: {
          $filter: filter,
          $orderby: "ContentDate/Start desc",
          $top: 10,
        },
        timeout: 15000,
      });
      return (response.data.value || []).map((p) => ({
        ...p,
        satellite: "Sentinel-2",
        resolution: "10m",
      }));
    } catch (err) {
      console.error("[Sentinel-2] 검색 실패:", err.message);
      return [];
    }
  }

  /**
   * Sentinel Hub Processing API - NDVI 이미지 생성
   * 무료 계정: 월 30,000 요청
   */
  async getSentinelHubNDVI(bbox, date, width = 512, height = 512) {
    const token = await this.getSentinelHubToken();
    if (!token) return null;

    try {
      const response = await axios.post(
        "https://services.sentinel-hub.com/api/v1/process",
        {
          input: {
            bounds: {
              bbox,
              properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" },
            },
            data: [
              {
                type: "sentinel-2-l2a",
                dataFilter: {
                  timeRange: {
                    from: `${date}T00:00:00Z`,
                    to: `${date}T23:59:59Z`,
                  },
                  maxCloudCoverage: 30,
                },
              },
            ],
          },
          output: {
            width,
            height,
            responses: [
              { identifier: "ndvi_color", format: { type: "image/png" } },
            ],
          },
          evalscript: SENTINEL2_NDVI_EVALSCRIPT,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "image/png",
          },
          responseType: "arraybuffer",
          timeout: 30000,
        }
      );
      return Buffer.from(response.data).toString("base64");
    } catch (err) {
      console.error("[SentinelHub] NDVI 이미지 생성 실패:", err.message);
      return null;
    }
  }

  /** Sentinel Hub OAuth2 토큰 */
  async getSentinelHubToken() {
    if (this.sentinelHubToken && this.tokenExpiry > Date.now()) {
      return this.sentinelHubToken;
    }

    const clientId = process.env.SENTINEL_HUB_CLIENT_ID;
    const clientSecret = process.env.SENTINEL_HUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      console.log("[SentinelHub] 인증 정보 없음 - 시뮬레이션 데이터 사용");
      return null;
    }

    try {
      const response = await axios.post(
        "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token",
        new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      this.sentinelHubToken = response.data.access_token;
      this.tokenExpiry = Date.now() + response.data.expires_in * 1000 - 60000;
      return this.sentinelHubToken;
    } catch (err) {
      console.error("[SentinelHub] 인증 실패:", err.message);
      return null;
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  3. HLS - Harmonized Landsat Sentinel-2 (30m, 2~3일)
  // ════════════════════════════════════════════════════════════════

  /**
   * NASA CMR STAC를 통한 HLS 데이터 검색
   * Sentinel-2 + Landsat 결합 → 2~3일 주기
   * 무료: NASA Earthdata Login 필요
   */
  async searchHLS(bbox, dateFrom, dateTo) {
    const [west, south, east, north] = bbox;

    try {
      // HLS Sentinel (HLSS30) + HLS Landsat (HLSL30)
      const collections = ["C2021957657-LPCLOUD", "C2021957295-LPCLOUD"];
      const results = [];

      for (const collection of collections) {
        const response = await axios.get(`${EARTHDATA_CMR_URL}/granules.json`, {
          params: {
            collection_concept_id: collection,
            temporal: `${dateFrom}T00:00:00Z,${dateTo}T23:59:59Z`,
            bounding_box: `${west},${south},${east},${north}`,
            page_size: 10,
            sort_key: "-start_date",
          },
          timeout: 15000,
        });

        const entries = response.data?.feed?.entry || [];
        for (const e of entries) {
          results.push({
            id: e.id,
            title: e.title,
            date: e.time_start?.split("T")[0],
            satellite: collection.includes("S30") ? "HLS-Sentinel" : "HLS-Landsat",
            resolution: "30m",
            cloud_cover: parseFloat(
              e.cloud_cover || e.attributes?.find((a) => a.name === "CLOUD_COVERAGE")?.values?.[0] || 0
            ),
            download_url: e.links?.find((l) => l.rel === "http://esipfed.org/ns/fedsearch/1.1/data#")?.href,
          });
        }
      }

      return results;
    } catch (err) {
      console.error("[HLS] 검색 실패:", err.message);
      return [];
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  4. Landsat 8/9 (30m, 16일)
  // ════════════════════════════════════════════════════════════════

  /**
   * USGS STAC를 통한 Landsat 검색
   */
  async searchLandsat(bbox, dateFrom, dateTo) {
    const [west, south, east, north] = bbox;

    try {
      const response = await axios.post(
        "https://landsatlook.usgs.gov/stac-server/search",
        {
          collections: ["landsat-c2l2-sr"],
          bbox: [west, south, east, north],
          datetime: `${dateFrom}T00:00:00Z/${dateTo}T23:59:59Z`,
          limit: 10,
          query: { "eo:cloud_cover": { lt: 30 } },
        },
        { timeout: 15000 }
      );

      return (response.data?.features || []).map((f) => ({
        id: f.id,
        date: f.properties?.datetime?.split("T")[0],
        satellite: f.properties?.platform === "LANDSAT_9" ? "Landsat-9" : "Landsat-8",
        resolution: "30m",
        cloud_cover: f.properties?.["eo:cloud_cover"],
        assets: f.assets,
      }));
    } catch (err) {
      console.error("[Landsat] 검색 실패:", err.message);
      return [];
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  5. VIIRS VNP13A1 (500m, 16일)
  // ════════════════════════════════════════════════════════════════

  /**
   * NASA CMR을 통한 VIIRS NDVI 검색
   */
  async searchVIIRS(bbox, dateFrom, dateTo) {
    const [west, south, east, north] = bbox;

    try {
      const response = await axios.get(`${EARTHDATA_CMR_URL}/granules.json`, {
        params: {
          short_name: "VNP13A1",
          version: "002",
          temporal: `${dateFrom}T00:00:00Z,${dateTo}T23:59:59Z`,
          bounding_box: `${west},${south},${east},${north}`,
          page_size: 10,
          sort_key: "-start_date",
        },
        timeout: 15000,
      });

      return (response.data?.feed?.entry || []).map((e) => ({
        id: e.id,
        title: e.title,
        date: e.time_start?.split("T")[0],
        satellite: "VIIRS",
        resolution: "500m",
        download_url: e.links?.find((l) => l.rel === "http://esipfed.org/ns/fedsearch/1.1/data#")?.href,
      }));
    } catch (err) {
      console.error("[VIIRS] 검색 실패:", err.message);
      return [];
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  6. MODIS (250m / 500m / 1km)
  // ════════════════════════════════════════════════════════════════

  /**
   * MODIS NDVI 조회 (완전 무료, API 키 불필요)
   * @param {string} product - MOD13Q1(250m) | MOD13A1(500m) | MOD13A2(1km)
   */
  async getMODISNDVI(lat, lng, dateFrom, dateTo, product = "MOD13Q1") {
    try {
      const response = await axios.get(`${MODIS_API_URL}/${product}/subset`, {
        params: {
          latitude: lat,
          longitude: lng,
          startDate: `A${dateFrom.replace(/-/g, "")}`,
          endDate: `A${dateTo.replace(/-/g, "")}`,
          kmAboveBelow: 1,
          kmLeftRight: 1,
        },
        timeout: 30000,
        headers: { Accept: "application/json" },
      });
      return response.data;
    } catch (err) {
      console.error(`[MODIS ${product}] 조회 실패:`, err.message);
      return null;
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  통합 검색 - 모든 위성 소스에서 동시 검색
  // ════════════════════════════════════════════════════════════════

  /**
   * 지정된 위성 또는 전체에서 데이터 검색
   * @param {object} options - { bbox, lat, lng, dateFrom, dateTo, satelliteId }
   */
  async searchAll(options) {
    const { bbox, lat, lng, dateFrom, dateTo, satelliteId } = options;
    const results = {};

    // 특정 위성 지정 시 해당 위성만 검색
    const targets = satelliteId
      ? SATELLITE_CATALOG.filter((s) => s.id === satelliteId && s.enabled)
      : SATELLITE_CATALOG.filter((s) => s.enabled);

    const promises = targets.map(async (sat) => {
      try {
        switch (sat.id) {
          case "planet-nicfi":
            results[sat.id] = await this.searchPlanetNICFI(bbox, dateFrom, dateTo);
            break;
          case "sentinel-2":
            results[sat.id] = await this.searchSentinel2(bbox, dateFrom, dateTo);
            break;
          case "hls":
            results[sat.id] = await this.searchHLS(bbox, dateFrom, dateTo);
            break;
          case "landsat-8":
          case "landsat-9":
            results[sat.id] = await this.searchLandsat(bbox, dateFrom, dateTo);
            break;
          case "viirs":
            results[sat.id] = await this.searchVIIRS(bbox, dateFrom, dateTo);
            break;
          case "modis-250m":
            results[sat.id] = await this.getMODISNDVI(lat, lng, dateFrom, dateTo, "MOD13Q1");
            break;
          case "modis-500m":
            results[sat.id] = await this.getMODISNDVI(lat, lng, dateFrom, dateTo, "MOD13A1");
            break;
          case "modis-1km":
            results[sat.id] = await this.getMODISNDVI(lat, lng, dateFrom, dateTo, "MOD13A2");
            break;
        }
      } catch (err) {
        results[sat.id] = { error: err.message };
      }
    });

    await Promise.allSettled(promises);
    return results;
  }

  // ════════════════════════════════════════════════════════════════
  //  일일 NDVI 수집 (크론 작업)
  // ════════════════════════════════════════════════════════════════

  async collectDailyNDVI() {
    const database = db.getDb();
    const courses =
      database._type === "sqlite"
        ? database.prepare("SELECT * FROM golf_courses").all()
        : database._data.golf_courses;

    const today = new Date().toISOString().split("T")[0];
    const results = [];

    for (const course of courses) {
      try {
        const boundary =
          typeof course.boundary === "string"
            ? JSON.parse(course.boundary)
            : course.boundary;
        const bbox = this.boundaryToBBox(boundary || [], course.lat, course.lng);

        // 우선순위: Sentinel-2 → HLS → Landsat → MODIS
        let satellite = "MODIS";
        let ndviMean = null;
        let cloudCover = 0;
        let ndviImage = null;

        // 1) Sentinel-2 검색 (10m, 최우선)
        const s2Data = await this.searchSentinel2(bbox, today, today);
        if (s2Data.length > 0) {
          satellite = "Sentinel-2";
          cloudCover = s2Data[0].cloudCover || 0;
          ndviImage = await this.getSentinelHubNDVI(bbox, today);
        }

        // 2) HLS 검색 (30m, 2~3일 주기)
        if (!s2Data.length) {
          const hlsData = await this.searchHLS(bbox, today, today);
          if (hlsData.length > 0) {
            satellite = hlsData[0].satellite;
            cloudCover = hlsData[0].cloud_cover || 0;
          }
        }

        // 3) Landsat 검색 (30m)
        if (satellite === "MODIS") {
          const lsData = await this.searchLandsat(bbox, today, today);
          if (lsData.length > 0) {
            satellite = lsData[0].satellite;
            cloudCover = lsData[0].cloud_cover || 0;
          }
        }

        // 4) MODIS NDVI (250m, 항상 가능)
        const modisData = await this.getMODISNDVI(course.lat, course.lng, today, today);
        ndviMean = modisData ? this.extractMODISNDVI(modisData) : null;

        // fallback: 시뮬레이션
        if (ndviMean == null) {
          ndviMean = this.simulateNDVI(course);
        }

        const record = {
          course_id: course.id,
          date: today,
          satellite,
          ndvi_mean: ndviMean,
          ndvi_min: ndviMean - 0.1,
          ndvi_max: ndviMean + 0.1,
          ndvi_std: 0.05,
          cloud_cover: cloudCover,
          ndvi_image_url: ndviImage ? `data:image/png;base64,${ndviImage}` : null,
        };

        if (database._type === "sqlite") {
          database
            .prepare(
              `INSERT INTO ndvi_records (course_id, date, satellite, ndvi_mean, ndvi_min, ndvi_max, ndvi_std, cloud_cover, ndvi_image_url)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              record.course_id, record.date, record.satellite,
              record.ndvi_mean, record.ndvi_min, record.ndvi_max,
              record.ndvi_std, record.cloud_cover, record.ndvi_image_url
            );
        } else {
          record.id = database._data.ndvi_records.length + 1;
          database._data.ndvi_records.push(record);
        }

        // 알림 체크
        if (ndviMean < 0.4) {
          this.createAlert(
            database, course.id, "전체", "ndvi_drop",
            ndviMean < 0.25 ? "critical" : "warning",
            `${course.name}: NDVI ${ndviMean.toFixed(3)} - 식생 상태 주의 [${satellite}]`,
            ndviMean, 0.4
          );
        }

        results.push(record);
      } catch (err) {
        console.error(`[수집실패] ${course.name}: ${err.message}`);
      }
    }

    if (database._type === "json") {
      database._save();
    }
    return results;
  }

  // ════════════════════════════════════════════════════════════════
  //  유틸리티
  // ════════════════════════════════════════════════════════════════

  extractMODISNDVI(modisData) {
    if (modisData && modisData.subset && modisData.subset.length > 0) {
      const values = modisData.subset[0].data || [];
      const validValues = values.filter((v) => v > 0 && v < 10000);
      if (validValues.length > 0) {
        const mean = validValues.reduce((a, b) => a + b, 0) / validValues.length;
        return mean / 10000;
      }
    }
    return null;
  }

  simulateNDVI(course) {
    const month = new Date().getMonth();
    let base = 0.55;
    if (month >= 3 && month <= 5) base = 0.7;
    if (month >= 6 && month <= 8) base = 0.8;
    if (month >= 9 && month <= 10) base = 0.6;
    if (month >= 11 || month <= 1) base = 0.35;
    return Math.max(0.1, Math.min(0.95, base + (Math.random() - 0.5) * 0.15));
  }

  boundaryToBBox(boundary, lat, lng) {
    if (boundary && boundary.length >= 3) {
      const lats = boundary.map((p) => p[0]);
      const lngs = boundary.map((p) => p[1]);
      return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
    }
    const d = 0.005;
    return [lng - d, lat - d, lng + d, lat + d];
  }

  createAlert(database, courseId, zone, type, severity, message, value, threshold) {
    if (database._type === "sqlite") {
      database
        .prepare(
          `INSERT INTO alerts (course_id, zone_name, alert_type, severity, message, ndvi_value, threshold)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(courseId, zone, type, severity, message, value, threshold);
    } else {
      database._data.alerts.push({
        id: database._data.alerts.length + 1,
        course_id: courseId,
        zone_name: zone,
        alert_type: type,
        severity,
        message,
        ndvi_value: value,
        threshold,
        is_read: 0,
        created_at: new Date().toISOString(),
      });
      database._save();
    }
  }
}

module.exports = new SatelliteService();
