/**
 * 고성능 이미지 처리 서비스
 * 
 * 최적화 기법:
 * 1. Worker Threads - CPU 집약 작업 병렬 처리
 * 2. Sharp SIMD - libvips 내장 AVX2/SSE 자동 활용
 * 3. 스트림 파이프라인 - 대용량 파일 메모리 효율
 * 4. 이미지 캐시 - MD5 해시 기반 중복 변환 방지
 * 5. 배치 처리 - 여러 이미지 동시 변환
 */
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

// Sharp 최적화 설정
sharp.cache({ memory: 256, files: 20, items: 100 });
sharp.concurrency(Math.max(1, os.cpus().length - 1)); // CPU 코어 - 1
sharp.simd(true); // SIMD 활성화 (AVX2/SSE 자동)

const CACHE_DIR = path.join(__dirname, "..", "data", "image_cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

class ImageProcessor {
  constructor() {
    this.processingQueue = [];
    this.isProcessing = false;
    this.stats = { processed: 0, cached: 0, totalTime: 0 };
  }

  /**
   * 단일 이미지 최적화 변환
   * @param {string} inputPath - 원본 파일 경로
   * @param {object} options - 변환 옵션
   * @returns {object} 변환 결과
   */
  async convertImage(inputPath, options = {}) {
    const start = Date.now();
    const {
      maxWidth = 4096,
      maxHeight = 4096,
      quality = 85,
      format = "png",
      outputDir = path.dirname(inputPath),
      generateThumb = true,
      thumbSize = 300,
    } = options;

    const ext = path.extname(inputPath).toLowerCase();
    const baseName = path.basename(inputPath, ext);

    // 캐시 확인 (파일 해시 기반)
    const fileHash = await this.getFileHash(inputPath);
    const cacheKey = `${fileHash}_${maxWidth}_${format}`;
    const cachedResult = this.checkCache(cacheKey);
    if (cachedResult) {
      this.stats.cached++;
      console.log(`[ImageProc] 캐시 히트: ${baseName} (${Date.now() - start}ms)`);
      return cachedResult;
    }

    try {
      // 메타데이터 읽기
      const metadata = await sharp(inputPath, { limitInputPixels: false }).metadata();
      console.log(`[ImageProc] 처리 시작: ${baseName} (${metadata.width}x${metadata.height} ${metadata.format})`);

      const results = {};

      // 1) 웹 표시용 변환 (리사이즈 + 포맷 변환)
      const webName = `${baseName}_web.${format}`;
      const webPath = path.join(outputDir, webName);

      const pipeline = sharp(inputPath, { limitInputPixels: false })
        .resize(maxWidth, maxHeight, {
          fit: "inside",
          withoutEnlargement: true,
          kernel: sharp.kernel.lanczos3, // 고품질 리사이즈
        });

      if (format === "png") {
        await pipeline.png({ compressionLevel: 6, adaptiveFiltering: true }).toFile(webPath);
      } else if (format === "webp") {
        await pipeline.webp({ quality, effort: 4 }).toFile(webPath);
      } else {
        await pipeline.jpeg({ quality, mozjpeg: true }).toFile(webPath);
      }

      const webStat = fs.statSync(webPath);
      results.web = {
        path: webPath,
        filename: webName,
        size: webStat.size,
        url: webPath.split("public")[1]?.replace(/\\/g, "/"),
      };

      // 2) 썸네일 생성 (300px, JPEG)
      if (generateThumb) {
        const thumbName = `${baseName}_thumb.jpg`;
        const thumbPath = path.join(outputDir, thumbName);

        await sharp(inputPath, { limitInputPixels: false })
          .resize(thumbSize, thumbSize, { fit: "cover", position: "centre" })
          .jpeg({ quality: 80, mozjpeg: true })
          .toFile(thumbPath);

        results.thumb = {
          path: thumbPath,
          filename: thumbName,
          size: fs.statSync(thumbPath).size,
          url: thumbPath.split("public")[1]?.replace(/\\/g, "/"),
        };
      }

      // 3) 중간 크기 (타일용, 1024px)
      const midName = `${baseName}_mid.jpg`;
      const midPath = path.join(outputDir, midName);
      await sharp(inputPath, { limitInputPixels: false })
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(midPath);

      results.mid = {
        path: midPath,
        filename: midName,
        size: fs.statSync(midPath).size,
      };

      const elapsed = Date.now() - start;
      this.stats.processed++;
      this.stats.totalTime += elapsed;

      results.metadata = {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        channels: metadata.channels,
        originalSize: fs.statSync(inputPath).size,
      };
      results.elapsed = elapsed;

      // 캐시 저장
      this.saveCache(cacheKey, results);

      console.log(`[ImageProc] 완료: ${baseName} | ${elapsed}ms | web: ${Math.round(webStat.size / 1024)}KB`);
      return results;
    } catch (err) {
      console.error(`[ImageProc] 실패: ${baseName}:`, err.message);
      throw err;
    }
  }

  /**
   * 배치 처리 - 여러 이미지 병렬 변환
   * @param {Array} files - [{inputPath, options}]
   * @param {number} concurrency - 동시 처리 수
   */
  async batchConvert(files, concurrency = null) {
    const maxConcurrency = concurrency || Math.max(1, os.cpus().length - 1);
    const start = Date.now();
    const results = [];

    console.log(`[ImageProc] 배치 처리: ${files.length}개 파일, 동시 ${maxConcurrency}개`);

    // 청크로 나누어 병렬 처리
    for (let i = 0; i < files.length; i += maxConcurrency) {
      const chunk = files.slice(i, i + maxConcurrency);
      const promises = chunk.map((f) =>
        this.convertImage(f.inputPath, f.options || {}).catch((err) => ({
          error: err.message,
          inputPath: f.inputPath,
        }))
      );
      const chunkResults = await Promise.all(promises);
      results.push(...chunkResults);

      console.log(`[ImageProc] 배치 진행: ${Math.min(i + maxConcurrency, files.length)}/${files.length}`);
    }

    const elapsed = Date.now() - start;
    const success = results.filter((r) => !r.error).length;
    console.log(`[ImageProc] 배치 완료: ${success}/${files.length} 성공 | ${elapsed}ms`);

    return { results, elapsed, success, failed: files.length - success };
  }

  // 파일 해시 (캐시 키)
  async getFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("md5");
      const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
      // 처음 1MB만 해시 (속도 최적화)
      let bytesRead = 0;
      stream.on("data", (chunk) => {
        if (bytesRead < 1024 * 1024) {
          hash.update(chunk);
          bytesRead += chunk.length;
        } else {
          stream.destroy();
        }
      });
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("close", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  // 캐시 확인
  checkCache(key) {
    const cachePath = path.join(CACHE_DIR, `${key}.json`);
    if (fs.existsSync(cachePath)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
        // 결과 파일이 실제로 존재하는지 확인
        if (cached.web?.path && fs.existsSync(cached.web.path)) {
          return cached;
        }
      } catch (e) {}
    }
    return null;
  }

  // 캐시 저장
  saveCache(key, result) {
    try {
      fs.writeFileSync(
        path.join(CACHE_DIR, `${key}.json`),
        JSON.stringify(result, null, 2),
        "utf-8"
      );
    } catch (e) {}
  }

  // 통계
  getStats() {
    return {
      ...this.stats,
      avgTime: this.stats.processed > 0 ? Math.round(this.stats.totalTime / this.stats.processed) : 0,
      cpus: os.cpus().length,
      concurrency: sharp.concurrency(),
      simd: true,
      cacheDir: CACHE_DIR,
      sharpVersion: sharp.versions,
    };
  }
}

module.exports = new ImageProcessor();
