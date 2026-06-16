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
    id: "planetscope",
    name: "PlanetScope (Education)",
    provider: "Planet Labs (Insights Platform)",
    resolution: "3m",
    resolution_m: 3,
    revisit: "매일",
    bands_nir: "B4 NIR (865nm)",
    bands_red: "B3 Red (665nm)",
    ndvi_formula: "(B4 - B3) / (B4 + B3)",
    coverage: "전 세계 (Education 계정 승인 필요)",
    cost: "무료 (Education/Research 계정)",
    api_url: "https://services.sentinel-hub.com/api/v1/process",
    tiles_url: "https://services.sentinel-hub.com/ogc/wmts/",
    auth: "Planet Insights OAuth2 (Client ID + Secret)",
    env_key: "PLANET_INSIGHTS_CLIENT_ID, PLANET_INSIGHTS_CLIENT_SECRET",
    data_format: "GeoTIFF / PNG (Processing API)",
    pros: "3m 해상도 매일 촬영. 골프장 그린/페어웨이/벙커 개별 식별 가능. Education 계정 무료",
    cons: "Education 계정 승인 필요. Processing Unit 할당량 존재",
    enabled: true,
    tier: "premium",
  },
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
    cons: "월 1회 모자이크만 무료, 일일 영상은 유료. 한국 커버리지 제한적",
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
  // ===== Planetary Variables (골프장 관리 핵심) =====
  {
    id: "soil-water-content",
    name: "Soil Water Content (토양수분)",
    provider: "Planet Labs (Planetary Variables)",
    resolution: "100m",
    resolution_m: 100,
    revisit: "거의 매일",
    bands_nir: "SWC (m³/m³)",
    bands_red: "-",
    ndvi_formula: "직접 제공 (토양수분량)",
    coverage: "전 세계",
    cost: "Subscriptions API (Education 계정 접근 가능 여부 확인 필요)",
    api_url: "https://services.sentinel-hub.com/api/v1/process",
    auth: "Planet Insights OAuth2 / Subscriptions API",
    env_key: "PLANET_INSIGHTS_CLIENT_ID",
    data_format: "GeoTIFF / PNG (Processing API)",
    pros: "관수 의사결정에 핵심. 구름 영향 없음(마이크로파 기반). 20년+ 아카이브. NDVI 하락 전 토양건조 사전 감지",
    cons: "100m 해상도로 골프장 내부 세부 구역 구분 한계. Subscriptions API 구독 필요",
    enabled: true,
    tier: "premium",
  },
  {
    id: "land-surface-temp",
    name: "Land Surface Temperature (지표면온도)",
    provider: "Planet Labs (Planetary Variables)",
    resolution: "100m",
    resolution_m: 100,
    revisit: "하루 2회 (01:30, 13:30 태양시)",
    bands_nir: "LST (Kelvin)",
    bands_red: "-",
    ndvi_formula: "직접 제공 (지표면 온도 K)",
    coverage: "전 세계",
    cost: "Subscriptions API (Education 계정 접근 가능 여부 확인 필요)",
    api_url: "https://services.sentinel-hub.com/api/v1/process",
    auth: "Planet Insights OAuth2 / Subscriptions API",
    env_key: "PLANET_INSIGHTS_CLIENT_ID",
    data_format: "GeoTIFF / PNG (Processing API)",
    pros: "여름철 잔디 열 스트레스 감지. 구름 영향 없음. 20년+ 아카이브. 낮/밤 온도 모두 측정",
    cons: "100m 해상도. Subscriptions API 구독 필요",
    enabled: true,
    tier: "premium",
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

// ─── 골프장 식생 모니터링 지수 Evalscripts (Sentinel-2 기반) ──────
// 각 지수는 골프장 잔디/식생의 다른 측면을 분석합니다

// 1. NDRE (Normalized Difference Red Edge Index)
// 용도: 초기 스트레스 감지 - NDVI보다 2~3주 빨리 변화 감지
// 밴드: B08(NIR) + B05(Red Edge 705nm)
const SENTINEL2_NDRE_EVALSCRIPT = `
//VERSION=3
function setup() {
  return { input: [{ bands: ["B05", "B08", "SCL"] }], output: { bands: 4 } };
}
function evaluatePixel(s) {
  if ([3,8,9,10].includes(s.SCL)) return [0.78, 0.78, 0.78, 1];
  let ndre = (s.B08 - s.B05) / (s.B08 + s.B05 + 0.0001);
  let r,g,b;
  if (ndre < 0.0)  {r=0.6;g=0.3;b=0.2;}
  else if (ndre < 0.1) {r=0.8;g=0.4;b=0.2;}
  else if (ndre < 0.2) {r=0.9;g=0.7;b=0.2;}
  else if (ndre < 0.3) {r=0.8;g=0.85;b=0.2;}
  else if (ndre < 0.4) {r=0.5;g=0.8;b=0.3;}
  else if (ndre < 0.5) {r=0.2;g=0.7;b=0.3;}
  else if (ndre < 0.6) {r=0.1;g=0.55;b=0.2;}
  else {r=0.04;g=0.4;b=0.1;}
  return [r, g, b, 1];
}
`;

// 2. GNDVI (Green Normalized Difference Vegetation Index)
// 용도: 엽록소 농도 측정, 질소 결핍 판단
// 밴드: B08(NIR) + B03(Green 560nm)
const SENTINEL2_GNDVI_EVALSCRIPT = `
//VERSION=3
function setup() {
  return { input: [{ bands: ["B03", "B08", "SCL"] }], output: { bands: 4 } };
}
function evaluatePixel(s) {
  if ([3,8,9,10].includes(s.SCL)) return [0.78, 0.78, 0.78, 1];
  let gndvi = (s.B08 - s.B03) / (s.B08 + s.B03 + 0.0001);
  let r,g,b;
  if (gndvi < 0.0)  {r=0.5;g=0.2;b=0.4;}
  else if (gndvi < 0.2) {r=0.7;g=0.3;b=0.5;}
  else if (gndvi < 0.3) {r=0.8;g=0.5;b=0.3;}
  else if (gndvi < 0.4) {r=0.9;g=0.75;b=0.2;}
  else if (gndvi < 0.5) {r=0.6;g=0.85;b=0.2;}
  else if (gndvi < 0.6) {r=0.3;g=0.8;b=0.2;}
  else if (gndvi < 0.7) {r=0.1;g=0.65;b=0.15;}
  else {r=0.04;g=0.45;b=0.08;}
  return [r, g, b, 1];
}
`;

// 3. SAVI (Soil Adjusted Vegetation Index)
// 용도: 토양 노출 영역(벙커, 카트도로 주변)의 정확한 식생 평가
// L=0.5 (중간 식생 밀도), 맨땅 영향 보정
const SENTINEL2_SAVI_EVALSCRIPT = `
//VERSION=3
function setup() {
  return { input: [{ bands: ["B04", "B08", "SCL"] }], output: { bands: 4 } };
}
function evaluatePixel(s) {
  if ([3,8,9,10].includes(s.SCL)) return [0.78, 0.78, 0.78, 1];
  let L = 0.5;
  let savi = ((s.B08 - s.B04) * (1 + L)) / (s.B08 + s.B04 + L + 0.0001);
  let r,g,b;
  if (savi < 0.0)  {r=0.5;g=0.35;b=0.25;}
  else if (savi < 0.1) {r=0.7;g=0.45;b=0.2;}
  else if (savi < 0.2) {r=0.85;g=0.65;b=0.15;}
  else if (savi < 0.3) {r=0.9;g=0.85;b=0.15;}
  else if (savi < 0.4) {r=0.6;g=0.85;b=0.2;}
  else if (savi < 0.5) {r=0.3;g=0.75;b=0.2;}
  else if (savi < 0.6) {r=0.15;g=0.6;b=0.15;}
  else {r=0.05;g=0.4;b=0.08;}
  return [r, g, b, 1];
}
`;

// 4. EVI (Enhanced Vegetation Index)
// 용도: 고밀도 식생(여름철 러프)에서 포화 없이 정확한 측정
// NDVI는 0.8 이상에서 포화되지만 EVI는 구분 가능
const SENTINEL2_EVI_EVALSCRIPT = `
//VERSION=3
function setup() {
  return { input: [{ bands: ["B02", "B04", "B08", "SCL"] }], output: { bands: 4 } };
}
function evaluatePixel(s) {
  if ([3,8,9,10].includes(s.SCL)) return [0.78, 0.78, 0.78, 1];
  let evi = 2.5 * (s.B08 - s.B04) / (s.B08 + 6*s.B04 - 7.5*s.B02 + 1 + 0.0001);
  evi = Math.max(-0.2, Math.min(1.0, evi));
  let r,g,b;
  if (evi < 0.0)  {r=0.55;g=0.3;b=0.2;}
  else if (evi < 0.1) {r=0.75;g=0.45;b=0.15;}
  else if (evi < 0.2) {r=0.9;g=0.7;b=0.1;}
  else if (evi < 0.3) {r=0.85;g=0.85;b=0.15;}
  else if (evi < 0.4) {r=0.55;g=0.85;b=0.2;}
  else if (evi < 0.5) {r=0.25;g=0.75;b=0.2;}
  else if (evi < 0.6) {r=0.1;g=0.6;b=0.12;}
  else {r=0.03;g=0.42;b=0.06;}
  return [r, g, b, 1];
}
`;

// 5. MSAVI2 (Modified Soil Adjusted Vegetation Index 2)
// 용도: 벙커/카트도로 인접 그린에서 토양 영향 최소화
// SAVI보다 자동화된 L값 (수동 설정 불필요)
const SENTINEL2_MSAVI2_EVALSCRIPT = `
//VERSION=3
function setup() {
  return { input: [{ bands: ["B04", "B08", "SCL"] }], output: { bands: 4 } };
}
function evaluatePixel(s) {
  if ([3,8,9,10].includes(s.SCL)) return [0.78, 0.78, 0.78, 1];
  let msavi = (2*s.B08 + 1 - Math.sqrt((2*s.B08+1)*(2*s.B08+1) - 8*(s.B08-s.B04))) / 2;
  msavi = Math.max(0, Math.min(1, msavi));
  let r,g,b;
  if (msavi < 0.1) {r=0.6;g=0.35;b=0.25;}
  else if (msavi < 0.2) {r=0.8;g=0.55;b=0.15;}
  else if (msavi < 0.3) {r=0.9;g=0.8;b=0.15;}
  else if (msavi < 0.4) {r=0.6;g=0.85;b=0.2;}
  else if (msavi < 0.5) {r=0.3;g=0.75;b=0.2;}
  else if (msavi < 0.6) {r=0.12;g=0.6;b=0.12;}
  else {r=0.04;g=0.4;b=0.06;}
  return [r, g, b, 1];
}
`;

// 6. NDMI (Normalized Difference Moisture Index)
// 용도: 잔디 수분 스트레스 감지, 관수 필요 구역 판별
// 밴드: B08(NIR) + B11(SWIR 1610nm)
const SENTINEL2_NDMI_EVALSCRIPT = `
//VERSION=3
function setup() {
  return { input: [{ bands: ["B08", "B11", "SCL"] }], output: { bands: 4 } };
}
function evaluatePixel(s) {
  if ([3,8,9,10].includes(s.SCL)) return [0.78, 0.78, 0.78, 1];
  let ndmi = (s.B08 - s.B11) / (s.B08 + s.B11 + 0.0001);
  let r,g,b;
  if (ndmi < -0.2) {r=0.7;g=0.2;b=0.1;}
  else if (ndmi < -0.1) {r=0.85;g=0.4;b=0.1;}
  else if (ndmi < 0.0) {r=0.95;g=0.7;b=0.2;}
  else if (ndmi < 0.1) {r=0.85;g=0.85;b=0.3;}
  else if (ndmi < 0.2) {r=0.5;g=0.8;b=0.4;}
  else if (ndmi < 0.3) {r=0.2;g=0.6;b=0.7;}
  else if (ndmi < 0.4) {r=0.1;g=0.4;b=0.8;}
  else {r=0.05;g=0.2;b=0.7;}
  return [r, g, b, 1];
}
`;

// 7. CIre (Chlorophyll Index Red Edge)
// 용도: 엽록소 함량 정밀 측정, 시비(비료) 효과 모니터링
// 밴드: B07(Red Edge 783nm) + B05(Red Edge 705nm)
const SENTINEL2_CIRE_EVALSCRIPT = `
//VERSION=3
function setup() {
  return { input: [{ bands: ["B05", "B07", "SCL"] }], output: { bands: 4 } };
}
function evaluatePixel(s) {
  if ([3,8,9,10].includes(s.SCL)) return [0.78, 0.78, 0.78, 1];
  let cire = (s.B07 / (s.B05 + 0.0001)) - 1;
  cire = Math.max(0, Math.min(5, cire));
  let t = cire / 5;
  let r = 0.8 - t * 0.7;
  let g = 0.3 + t * 0.5;
  let b = 0.1 + t * 0.1;
  return [r, g, b, 1];
}
`;

// 8. GLI (Green Leaf Index)
// 용도: 잔디 녹색도/건강도, RGB만으로 간단 평가 (드론 영상 호환)
const SENTINEL2_GLI_EVALSCRIPT = `
//VERSION=3
function setup() {
  return { input: [{ bands: ["B02", "B03", "B04", "SCL"] }], output: { bands: 4 } };
}
function evaluatePixel(s) {
  if ([3,8,9,10].includes(s.SCL)) return [0.78, 0.78, 0.78, 1];
  let gli = (2*s.B03 - s.B04 - s.B02) / (2*s.B03 + s.B04 + s.B02 + 0.0001);
  gli = Math.max(-0.3, Math.min(0.5, gli));
  let t = (gli + 0.3) / 0.8;
  let r = 0.8 * (1-t);
  let g = 0.3 + 0.6*t;
  let b = 0.15;
  return [r, g, b, 1];
}
`;

// 지수 카탈로그 (프론트에서 선택 가능)
const VEGETATION_INDICES = [
  {
    id: "ndvi", name: "NDVI", fullName: "Normalized Difference Vegetation Index",
    formula: "(NIR - Red) / (NIR + Red)", bands: "B08 + B04",
    description: "기본 식생 건강도 지수. 전반적인 잔디 상태 평가",
    golf_use: "전체 코스 식생 상태 모니터링",
    range: "0.0 ~ 1.0 (0.6 이상 건강)",
    evalscript: "SENTINEL2_NDVI",
    color: "#4ade80",
  },
  {
    id: "ndre", name: "NDRE", fullName: "Normalized Difference Red Edge Index",
    formula: "(NIR - RedEdge) / (NIR + RedEdge)", bands: "B08 + B05",
    description: "초기 스트레스를 NDVI보다 2~3주 빨리 감지. Red Edge 밴드 활용",
    golf_use: "페어웨이/그린 스트레스 조기 경보",
    range: "0.0 ~ 0.8 (0.4 이상 건강)",
    evalscript: "SENTINEL2_NDRE",
    color: "#fb923c",
  },
  {
    id: "gndvi", name: "GNDVI", fullName: "Green NDVI",
    formula: "(NIR - Green) / (NIR + Green)", bands: "B08 + B03",
    description: "엽록소 농도와 질소 함량 측정. 시비 효과 판단",
    golf_use: "질소 결핍 구역 식별, 비료 시비 계획",
    range: "0.0 ~ 0.8 (0.5 이상 양호)",
    evalscript: "SENTINEL2_GNDVI",
    color: "#a78bfa",
  },
  {
    id: "savi", name: "SAVI", fullName: "Soil Adjusted Vegetation Index",
    formula: "((NIR - Red)(1+L)) / (NIR + Red + L)", bands: "B08 + B04",
    description: "토양 노출 영역에서 정확한 식생 평가. L=0.5",
    golf_use: "벙커/카트도로 주변 그린/페어웨이 상태",
    range: "0.0 ~ 0.7 (0.35 이상 양호)",
    evalscript: "SENTINEL2_SAVI",
    color: "#2dd4bf",
  },
  {
    id: "evi", name: "EVI", fullName: "Enhanced Vegetation Index",
    formula: "2.5(NIR-Red) / (NIR+6Red-7.5Blue+1)", bands: "B08 + B04 + B02",
    description: "고밀도 식생에서 NDVI 포화 없이 정확 측정",
    golf_use: "여름철 러프/나무 지역 정밀 분석",
    range: "-0.2 ~ 1.0 (0.3 이상 양호)",
    evalscript: "SENTINEL2_EVI",
    color: "#60a5fa",
  },
  {
    id: "msavi2", name: "MSAVI2", fullName: "Modified Soil Adjusted VI",
    formula: "(2NIR+1-sqrt((2NIR+1)²-8(NIR-Red)))/2", bands: "B08 + B04",
    description: "토양 보정 자동화. 벙커 인접 구역에 최적",
    golf_use: "벙커 주변 그린 가장자리 정밀 분석",
    range: "0.0 ~ 1.0 (0.35 이상 양호)",
    evalscript: "SENTINEL2_MSAVI2",
    color: "#f87171",
  },
  {
    id: "ndmi", name: "NDMI", fullName: "Normalized Difference Moisture Index",
    formula: "(NIR - SWIR) / (NIR + SWIR)", bands: "B08 + B11",
    description: "잔디 수분 스트레스 감지. 관수 필요 구역 판별",
    golf_use: "관수 의사결정, 가뭄 스트레스 구역 파악",
    range: "-0.3 ~ 0.5 (0.1 이상 수분 양호)",
    evalscript: "SENTINEL2_NDMI",
    color: "#38bdf8",
  },
  {
    id: "cire", name: "CIre", fullName: "Chlorophyll Index Red Edge",
    formula: "(B07 / B05) - 1", bands: "B07 + B05",
    description: "엽록소 함량 정밀 측정. 시비 전후 효과 비교",
    golf_use: "시비(비료) 효과 모니터링, 질소 관리",
    range: "0.0 ~ 5.0 (1.5 이상 양호)",
    evalscript: "SENTINEL2_CIRE",
    color: "#4ade80",
  },
  {
    id: "gli", name: "GLI", fullName: "Green Leaf Index",
    formula: "(2G - R - B) / (2G + R + B)", bands: "B03 + B04 + B02",
    description: "RGB만으로 녹색도 평가. 드론 영상과 호환",
    golf_use: "간편한 잔디 녹색도 확인, 드론 비교 분석",
    range: "-0.3 ~ 0.5 (0.1 이상 녹색)",
    evalscript: "SENTINEL2_GLI",
    color: "#86efac",
  },
];

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

// PlanetScope NDVI Evalscript (Planet Insights Processing API)
// PlanetScope 8-band: coastal_blue, blue, green_i, green, yellow, red, rededge, nir
const PLANETSCOPE_NDVI_EVALSCRIPT = `
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["nir", "red"], units: "REFLECTANCE" }],
    output: { bands: 3, sampleType: "AUTO" }
  };
}
function evaluatePixel(s) {
  let ndvi = (s.nir - s.red) / (s.nir + s.red + 0.0001);
  // Color ramp
  if (ndvi < 0.0)  return [0.5, 0.4, 0.3];
  if (ndvi < 0.15) return [0.8, 0.5, 0.3];
  if (ndvi < 0.25) return [0.82, 0.67, 0.23];
  if (ndvi < 0.35) return [0.86, 0.82, 0.2];
  if (ndvi < 0.45) return [0.7, 0.82, 0.2];
  if (ndvi < 0.55) return [0.5, 0.78, 0.23];
  if (ndvi < 0.65) return [0.3, 0.7, 0.2];
  if (ndvi < 0.75) return [0.16, 0.59, 0.12];
  return [0.04, 0.43, 0.04];
}
`;

// PlanetScope True Color (RGB) Evalscript
const PLANETSCOPE_RGB_EVALSCRIPT = `
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["red", "green", "blue"], units: "REFLECTANCE" }],
    output: { bands: 3, sampleType: "AUTO" }
  };
}
function evaluatePixel(s) {
  let gain = 3.5;
  return [s.red * gain, s.green * gain, s.blue * gain];
}
`;

// Soil Water Content Evalscript (Planet Planetary Variables)
const SWC_EVALSCRIPT = `
//VERSION=3
const vmin = 0;
const vmax = 0.4;
function setup() {
  return { input: ["SWC", "dataMask"], output: { bands: 4 } };
}
const cmap = [
  [0.0, 0xfff7ea],[0.05, 0xfaedda],[0.1, 0xede4cb],[0.15, 0xdedcbd],
  [0.2, 0xced3af],[0.25, 0xbdcba3],[0.3, 0xaac398],[0.35, 0x96bc90],
  [0.4, 0x80b48a],[0.45, 0x68ac86],[0.5, 0x4da484],[0.55, 0x269c83],
  [0.6, 0x009383],[0.65, 0x008a85],[0.7, 0x008186],[0.75, 0x007788],
  [0.8, 0x006d8a],[0.85, 0x00618c],[0.9, 0x00558d],[0.95, 0x00478f],
  [1.0, 0x003492]
];
function updateColormap(min, max) {
  const n = cmap.length;
  const step = (max - min) / (n - 1);
  for (let i = 0; i < n; i++) cmap[i][0] = min + step * i;
}
updateColormap(vmin, vmax);
const viz = new ColorRampVisualizer(cmap);
function evaluatePixel(sample) {
  let val = sample.SWC / 1000;
  let c = viz.process(val);
  return [...c, sample.dataMask];
}
`;

// Land Surface Temperature Evalscript (Planet Planetary Variables)
const LST_EVALSCRIPT = `
//VERSION=3
const color_min = 263;
const color_max = 340;
const sensing_time = "1330";
function setup() {
  return { input: ["LST", "dataMask"], output: { bands: 4 }, mosaicking: "TILE" };
}
function preProcessScenes(collections) {
  collections.scenes.tiles = collections.scenes.tiles.filter(
    t => t.dataPath.includes("T" + sensing_time)
  );
  collections.scenes.tiles.sort((a, b) => new Date(b.date) - new Date(a.date));
  return collections;
}
const cmap = [
  [263, 0x000004],[266, 0x06051a],[270, 0x140e36],[274, 0x251255],
  [278, 0x3b0f70],[282, 0x51127c],[286, 0x641a80],[289, 0x782281],
  [293, 0x8c2981],[297, 0xa1307e],[301, 0xb73779],[305, 0xca3e72],
  [309, 0xde4968],[313, 0xed5a5f],[316, 0xf7705c],[320, 0xfc8961],
  [324, 0xfe9f6d],[328, 0xfeb77e],[332, 0xfecf92],[336, 0xfde7a9],
  [340, 0xfcfdbf]
];
function updateCMap(min, max) {
  const n = cmap.length;
  const step = (max - min) / (n - 1);
  for (let i = 0; i < n; i++) cmap[i][0] = min + step * i;
}
updateCMap(color_min, color_max);
const viz = new ColorRampVisualizer(cmap);
function evaluatePixel(samples) {
  const sf = 100;
  const dm = samples[0].dataMask;
  let val = NaN;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].dataMask === 1) { val = samples[i].LST / sf; break; }
  }
  let c = viz.process(val);
  return [...c, dm];
}
`;

// ─── API Endpoints ───────────────────────────────────────────────

const CDSE_API_URL = "https://catalogue.dataspace.copernicus.eu/odata/v1";
const MODIS_API_URL = "https://modis.ornl.gov/rst/api/v1";
const EARTHDATA_CMR_URL = "https://cmr.earthdata.nasa.gov/search";
const APPEEARS_URL = "https://appeears.earthdatacloud.nasa.gov/api";
const USGS_M2M_URL = "https://m2m.cr.usgs.gov/api/api/json/stable";
const PLANET_API_URL = "https://api.planet.com/basemaps/v1/mosaics";
const PLANET_INSIGHTS_AUTH_URL = "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token";
const PLANET_INSIGHTS_PROCESS_URL = "https://services.sentinel-hub.com/api/v1/process";
const PLANET_INSIGHTS_CATALOG_URL = "https://services.sentinel-hub.com/api/v1/catalog/1.0.0/search";

// ─── Service Class ───────────────────────────────────────────────

class SatelliteService {
  constructor() {
    this.sentinelHubToken = null;
    this.tokenExpiry = null;
    this.planetInsightsToken = null;
    this.planetInsightsTokenExpiry = null;
  }

  // ════════════════════════════════════════════════════════════════
  //  카탈로그 조회
  // ════════════════════════════════════════════════════════════════

  /** 전체 위성 카탈로그 반환 */
  getCatalog() {
    return SATELLITE_CATALOG;
  }

  /** 식생 지수 카탈로그 반환 */
  getVegetationIndices() {
    return VEGETATION_INDICES;
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
  //  0. PlanetScope via Insights Platform (3m, 매일)
  //     Education 계정: Planet Insights Platform → OAuth2 인증
  //     Processing API로 NDVI/실화상 이미지 생성
  // ════════════════════════════════════════════════════════════════

  /**
   * Planet Insights Platform OAuth2 토큰 취득
   * insights.planet.com → Settings → OAuth Clients
   */
  async getPlanetInsightsToken() {
    if (this.planetInsightsToken && this.planetInsightsTokenExpiry > Date.now()) {
      return this.planetInsightsToken;
    }

    const clientId = process.env.PLANET_INSIGHTS_CLIENT_ID;
    const clientSecret = process.env.PLANET_INSIGHTS_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return null;
    }

    try {
      const response = await axios.post(
        PLANET_INSIGHTS_AUTH_URL,
        new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );
      this.planetInsightsToken = response.data.access_token;
      this.planetInsightsTokenExpiry = Date.now() + response.data.expires_in * 1000 - 60000;
      console.log("[PlanetScope] OAuth2 토큰 취득 성공");
      return this.planetInsightsToken;
    } catch (err) {
      console.error("[PlanetScope] 인증 실패:", err.response?.data || err.message);
      return null;
    }
  }

  /**
   * PlanetScope 인증 테스트 - 토큰 발급 가능한지 확인
   */
  async testPlanetConnection() {
    const clientId = process.env.PLANET_INSIGHTS_CLIENT_ID;
    const clientSecret = process.env.PLANET_INSIGHTS_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return { ok: false, error: "PLANET_INSIGHTS_CLIENT_ID / SECRET이 .env에 설정되지 않았습니다." };
    }

    try {
      const token = await this.getPlanetInsightsToken();
      if (!token) return { ok: false, error: "토큰 발급 실패" };

      // Catalog 접근 테스트 - 서울 근처 최근 30일
      const testBbox = [126.9, 37.4, 127.1, 37.6];
      const dateTo = new Date().toISOString().split("T")[0];
      const dateFrom = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
      const searchResult = await this.searchPlanetScope(testBbox, dateFrom, dateTo);

      return {
        ok: true,
        token_length: token.length,
        test_search: {
          bbox: testBbox,
          period: `${dateFrom} ~ ${dateTo}`,
          results: searchResult.length,
          first: searchResult[0] || null,
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * PlanetScope Catalog 검색 (Sentinel Hub Catalog API)
   * Collection: "planetscope" (Planet Insights Platform에서 사용 가능)
   */
  async searchPlanetScope(bbox, dateFrom, dateTo) {
    const token = await this.getPlanetInsightsToken();
    if (!token) return [];

    try {
      const response = await axios.post(
        PLANET_INSIGHTS_CATALOG_URL,
        {
          bbox,
          datetime: `${dateFrom}T00:00:00Z/${dateTo}T23:59:59Z`,
          collections: ["planetscope"],
          limit: 20,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          timeout: 15000,
        }
      );

      return (response.data?.features || []).map((f) => ({
        id: f.id,
        date: f.properties?.datetime?.split("T")[0],
        satellite: "PlanetScope",
        resolution: "3m",
        cloud_cover: f.properties?.["eo:cloud_cover"],
      }));
    } catch (err) {
      // 에러 상세 로깅
      const detail = err.response?.data
        ? (typeof err.response.data === "string" ? err.response.data : JSON.stringify(err.response.data).substring(0, 500))
        : err.message;
      console.error("[PlanetScope] Catalog 검색 실패:", detail);
      return [];
    }
  }

  /**
   * PlanetScope 이미지 생성 (Processing API)
   * @param {string} type - "ndvi" | "rgb"
   * @returns {string|null} base64 PNG
   */
  async getPlanetScopeImage(bbox, date, type = "ndvi", width = 512, height = 512) {
    const token = await this.getPlanetInsightsToken();
    if (!token) return null;

    const evalscript = type === "ndvi" ? PLANETSCOPE_NDVI_EVALSCRIPT : PLANETSCOPE_RGB_EVALSCRIPT;

    try {
      const response = await axios.post(
        PLANET_INSIGHTS_PROCESS_URL,
        {
          input: {
            bounds: {
              bbox,
              properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" },
            },
            data: [{
              type: "planetscope",
              dataFilter: {
                timeRange: {
                  from: `${date}T00:00:00Z`,
                  to: `${date}T23:59:59Z`,
                },
                maxCloudCoverage: 30,
              },
            }],
          },
          output: {
            width,
            height,
            responses: [{ identifier: "default", format: { type: "image/png" } }],
          },
          evalscript,
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
      const status = err.response?.status;
      const detail = err.response?.data
        ? Buffer.from(err.response.data).toString("utf-8").substring(0, 300)
        : err.message;
      console.error(`[PlanetScope] ${type} 이미지 (${status}):`, detail);
      return null;
    }
  }

  /** PlanetScope 연결 상태 */
  getPlanetScopeStatus() {
    const clientId = process.env.PLANET_INSIGHTS_CLIENT_ID;
    const clientSecret = process.env.PLANET_INSIGHTS_CLIENT_SECRET;
    return {
      configured: !!(clientId && clientSecret),
      clientId: clientId ? clientId.substring(0, 8) + "..." : null,
    };
  }

  // ════════════════════════════════════════════════════════════════
  //  Planetary Variables: SWC (토양수분) / LST (지표면온도)
  //  BYOC Collection → Processing API evalscript 방식
  //  Subscriptions API로 데이터 구독 필요 (Education 계정 가능 여부 확인 필요)
  //  대안: Sentinel Hub에서 직접 접근 가능한 공개 데이터로 시뮬레이션
  // ════════════════════════════════════════════════════════════════

  /**
   * SWC (토양수분) 이미지 생성
   * Planet BYOC Collection ID가 필요 (Subscriptions로 구독 후 발급됨)
   * BYOC ID가 없으면 시뮬레이션 데이터로 대체
   */
  async getSoilWaterContentImage(bbox, date, width = 512, height = 512) {
    const token = await this.getPlanetInsightsToken();
    const byocId = process.env.PLANET_SWC_COLLECTION_ID;

    if (token && byocId) {
      // Real API call with BYOC collection
      try {
        const r = await axios.post(PLANET_INSIGHTS_PROCESS_URL, {
          input: {
            bounds: { bbox, properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" } },
            data: [{ type: byocId, dataFilter: { timeRange: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` } } }],
          },
          output: { width, height, responses: [{ identifier: "default", format: { type: "image/png" } }] },
          evalscript: SWC_EVALSCRIPT,
        }, {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "image/png" },
          responseType: "arraybuffer",
          timeout: 30000,
        });
        return { type: "real", image: Buffer.from(r.data).toString("base64") };
      } catch (err) {
        console.error("[SWC] Processing 실패:", err.message);
      }
    }

    // Simulation: 골프장 영역에 대한 시뮬레이션 SWC 데이터 생성
    return { type: "simulated", data: this.simulateSWC(bbox, date) };
  }

  /**
   * LST (지표면온도) 이미지 생성
   */
  async getLandSurfaceTempImage(bbox, date, width = 512, height = 512) {
    const token = await this.getPlanetInsightsToken();
    const byocId = process.env.PLANET_LST_COLLECTION_ID;

    if (token && byocId) {
      try {
        const r = await axios.post(PLANET_INSIGHTS_PROCESS_URL, {
          input: {
            bounds: { bbox, properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" } },
            data: [{ type: byocId, dataFilter: { timeRange: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` } } }],
          },
          output: { width, height, responses: [{ identifier: "default", format: { type: "image/png" } }] },
          evalscript: LST_EVALSCRIPT,
        }, {
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "image/png" },
          responseType: "arraybuffer",
          timeout: 30000,
        });
        return { type: "real", image: Buffer.from(r.data).toString("base64") };
      } catch (err) {
        console.error("[LST] Processing 실패:", err.message);
      }
    }

    return { type: "simulated", data: this.simulateLST(bbox, date) };
  }

  /** SWC 시뮬레이션 데이터 (m³/m³) */
  simulateSWC(bbox, date) {
    const month = new Date(date).getMonth();
    // 계절 기반 기본값 (한국 기후)
    let base = 0.25; // m³/m³
    if (month >= 6 && month <= 8) base = 0.32; // 여름 장마
    if (month >= 11 || month <= 2) base = 0.15; // 겨울 건조
    if (month >= 3 && month <= 5) base = 0.22; // 봄

    const [w, s, e, n] = bbox;
    const rows = 8, cols = 8;
    const grid = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const noise = (Math.random() - 0.5) * 0.1;
        grid.push({
          lat: s + (n - s) * (r + 0.5) / rows,
          lng: w + (e - w) * (c + 0.5) / cols,
          swc: Math.max(0.05, Math.min(0.5, base + noise)),
        });
      }
    }
    return {
      mean: Math.round(base * 1000) / 1000,
      unit: "m³/m³",
      date,
      grid,
      status: base < 0.15 ? "건조 - 관수 필요" : base < 0.25 ? "보통" : "양호",
    };
  }

  /** LST 시뮬레이션 데이터 (°C) */
  simulateLST(bbox, date) {
    const month = new Date(date).getMonth();
    let base = 15; // °C
    if (month >= 6 && month <= 8) base = 32;
    if (month >= 11 || month <= 2) base = 2;
    if (month >= 3 && month <= 5) base = 18;
    if (month >= 9 && month <= 10) base = 20;

    const [w, s, e, n] = bbox;
    const rows = 8, cols = 8;
    const grid = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const noise = (Math.random() - 0.5) * 6;
        grid.push({
          lat: s + (n - s) * (r + 0.5) / rows,
          lng: w + (e - w) * (c + 0.5) / cols,
          temp: Math.round((base + noise) * 10) / 10,
        });
      }
    }
    return {
      mean: base,
      unit: "°C",
      date,
      grid,
      status: base > 35 ? "열 스트레스 위험" : base > 30 ? "고온 주의" : base > 25 ? "양호" : "정상",
    };
  }

  // ════════════════════════════════════════════════════════════════
  //  1. Planet NICFI (4.77m) - 최고 해상도 무료 위성
  // ════════════════════════════════════════════════════════════════

  /**
   * Planet Basemaps 모자이크 목록 조회 (global_monthly 시리즈)
   * 한국 포함 전 세계 4.77m 월간 모자이크
   */
  async listPlanetBasemaps() {
    const apiKey = process.env.PLANET_API_KEY;
    if (!apiKey) return [];

    try {
      let allMosaics = [];
      let nextUrl = `${PLANET_API_URL}?_page_size=200`;
      while (nextUrl) {
        const r = await axios.get(nextUrl, {
          auth: { username: apiKey, password: "" },
          timeout: 15000,
        });
        allMosaics = allMosaics.concat(r.data.mosaics || []);
        nextUrl = r.data._links?._next || null;
        if (allMosaics.length > 300) break;
      }

      return allMosaics
        .filter((m) => m.name.startsWith("global_monthly"))
        .sort((a, b) => b.name.localeCompare(a.name))
        .map((m) => ({
          name: m.name,
          date_from: m.first_acquired?.split("T")[0],
          date_to: m.last_acquired?.split("T")[0],
          resolution: m.grid?.resolution,
          tileUrl: `https://tiles.planet.com/basemaps/v1/planet-tiles/${m.name}/gmap/{z}/{x}/{y}.png?api_key=${apiKey}`,
        }));
    } catch (err) {
      console.error("[Planet Basemaps] 목록 조회 실패:", err.message);
      return [];
    }
  }

  /**
   * Planet NICFI 모자이크 검색 (날짜 필터)
   */
  async searchPlanetNICFI(bbox, dateFrom, dateTo) {
    const apiKey = process.env.PLANET_API_KEY;
    if (!apiKey) {
      console.log("[Planet] API Key 없음");
      return [];
    }

    try {
      const response = await axios.get(PLANET_API_URL, {
        params: { name__contains: "global_monthly", _page_size: 100 },
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
          satellite: "Planet Basemaps",
          resolution: "4.77m",
          tileUrl: `https://tiles.planet.com/basemaps/v1/planet-tiles/${m.name}/gmap/{z}/{x}/{y}.png?api_key=${apiKey}`,
        }));
    } catch (err) {
      console.error("[Planet Basemaps] 검색 실패:", err.message);
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
          case "planetscope":
            results[sat.id] = await this.searchPlanetScope(bbox, dateFrom, dateTo);
            break;
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
