// src/config/config.service.ts
import 'reflect-metadata'; // Cần thiết cho tsyringe hoạt động đúng
import { singleton } from 'tsyringe';
import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';

// Định nghĩa schema cho các biến môi trường bạn cần
const envSchema = z.object({
    // --- Paths ---
    // Nên có một thư mục gốc cho tất cả output
    BASE_OUTPUT_DIR: z.string().default(path.join(__dirname, '../../data/crawl_output')), // Ví dụ đường dẫn gốc

    // --- Google Search ---
    GOOGLE_CSE_ID: z.string(),
    // Parse chuỗi key thành mảng, loại bỏ khoảng trắng
    GOOGLE_CUSTOM_SEARCH_API_KEYS: z.string().transform((val) => val.split(',').map(key => key.trim()).filter(key => key)),
    MAX_USAGE_PER_KEY: z.coerce.number().int().positive().default(90), // Chuyển string thành number
    KEY_ROTATION_DELAY_MS: z.coerce.number().int().positive().default(5000),
    MAX_SEARCH_RETRIES: z.coerce.number().int().nonnegative().default(2),
    RETRY_DELAY_MS: z.coerce.number().int().positive().default(1000),
    SEARCH_QUERY_TEMPLATE: z.string().default('${Title} ${Acronym} ${Year2} ${Year3} conference'), // Giữ template cũ hoặc tùy chỉnh

    // --- Filtering & Limits ---
    // Parse chuỗi thành mảng
    UNWANTED_DOMAINS: z.string().transform((val) => val.split(',').map(d => d.trim().toLowerCase()).filter(d => d)),
    SKIP_KEYWORDS: z.string().transform((val) => val.split(',').map(k => k.trim().toLowerCase()).filter(k => k)),
    MAX_LINKS: z.coerce.number().int().positive().default(4),

    // --- Crawling Years ---
    YEAR1: z.coerce.number().int().default(new Date().getFullYear() + 1),
    YEAR2: z.coerce.number().int().default(new Date().getFullYear()),
    YEAR3: z.coerce.number().int().default(new Date().getFullYear() - 1),

    // --- Queue ---
    CRAWL_CONCURRENCY: z.coerce.number().int().positive().default(5), // Ví dụ concurrency

    // --- Logging ---
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
});

export type AppConfig = z.infer<typeof envSchema>;

@singleton() // Đảm bảo chỉ có một instance ConfigService
export class ConfigService {
    public readonly config: AppConfig;

    constructor() {
        dotenv.config(); // Load .env
        try {
            this.config = envSchema.parse(process.env);
            console.log("Configuration loaded successfully.");
            // console.log("Loaded config:", this.config); // Uncomment để debug
        } catch (error) {
            if (error instanceof z.ZodError) {
                console.error("❌ Invalid environment variables:", error.format());
            } else {
                console.error("❌ Error loading configuration:", error);
            }
            process.exit(1); // Thoát nếu config không hợp lệ
        }
    }

    // --- Helper methods để lấy đường dẫn output ---
    // Các path này sẽ được tính toán dựa trên BASE_OUTPUT_DIR

    get baseOutputDir(): string {
        return this.config.BASE_OUTPUT_DIR;
    }

    get conferenceListPath(): string {
        return path.join(this.baseOutputDir, 'conference_list.json');
    }

    get finalOutputJsonlPath(): string {
        return path.join(this.baseOutputDir, 'final_output.jsonl');
    }

    get evaluateCsvPath(): string {
        return path.join(this.baseOutputDir, 'evaluate.csv');
    }

    get customSearchDir(): string {
        return path.join(this.baseOutputDir, 'custom_search');
    }

    get sourceRankDir(): string { // Giả sử bạn vẫn cần thư mục này
        return path.join(this.baseOutputDir, 'source_rank');
    }

    get batchesDir(): string { // Giữ lại nếu logic batching file vẫn cần
        return path.join(this.baseOutputDir, 'batches');
    }

    get tempDir(): string { // Thư mục cho các file tạm khác nếu có
        return path.join(this.baseOutputDir, 'temp');
    }

    // --- Thêm các getter khác nếu cần ---
}

// Example .env file structure:
/*
# .env
BASE_OUTPUT_DIR=./data/crawl_output_dev

GOOGLE_CSE_ID=YOUR_CSE_ID
GOOGLE_CUSTOM_SEARCH_API_KEYS=API_KEY_1,API_KEY_2,API_KEY_3
MAX_USAGE_PER_KEY=95
KEY_ROTATION_DELAY_MS=6000
MAX_SEARCH_RETRIES=3
RETRY_DELAY_MS=1500
SEARCH_QUERY_TEMPLATE="${Title} ${Acronym} ${Year2} ${Year3} conference"

UNWANTED_DOMAINS=linkedin.com,facebook.com,researchgate.net
SKIP_KEYWORDS=call for papers,cfp,submit
MAX_LINKS=5

YEAR1=2025
YEAR2=2024
YEAR3=2023

CRAWL_CONCURRENCY=4
LOG_LEVEL=debug
*/