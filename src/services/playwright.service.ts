// src/services/playwright.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { Browser, BrowserContext } from 'playwright';
import { setupPlaywright } from '../utils/crawl/playwrightSetup'; // Import hàm gốc
import { LoggingService } from './logging.service';
import { Logger } from 'pino';

@singleton()
export class PlaywrightService {
    private browser: Browser | null = null;
    private browserContext: BrowserContext | null = null;
    private readonly logger: Logger;
    private isInitialized = false;
    private isInitializing = false;

    constructor(@inject(LoggingService) private loggingService: LoggingService) {
        this.logger = this.loggingService.getLogger({ service: 'PlaywrightService' });
    }

    // Khởi tạo trình duyệt và context (chỉ chạy 1 lần)
    async initialize(): Promise<void> {
        if (this.isInitialized || this.isInitializing) {
            this.logger.debug("Playwright already initialized or initializing.");
            // Optional: Wait if another process is initializing
            while (this.isInitializing) {
               await new Promise(resolve => setTimeout(resolve, 100));
            }
            return;
        }
        this.isInitializing = true;
        this.logger.info("Initializing Playwright browser...");
        try {
            const { browser, browserContext } = await setupPlaywright(); // Gọi hàm gốc
            this.browser = browser;
            this.browserContext = browserContext;
            this.isInitialized = true;
            this.logger.info("Playwright browser initialized successfully.");
        } catch (error) {
            this.logger.fatal({ err: error }, "Failed to initialize Playwright browser.");
            throw error; // Ném lỗi để dừng quá trình nếu cần
        } finally {
             this.isInitializing = false;
        }
    }

    // Lấy browser context (phải gọi initialize trước)
    getBrowserContext(): BrowserContext {
        if (!this.isInitialized || !this.browserContext) {
            const errorMsg = "Playwright browser context requested before initialization or initialization failed.";
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }
        return this.browserContext;
    }

    // Đóng trình duyệt
    async close(): Promise<void> {
        if (this.isInitializing){
            this.logger.warn("Attempting to close Playwright while it is still initializing.");
            // Wait for initialization to finish before closing
             while (this.isInitializing) {
               await new Promise(resolve => setTimeout(resolve, 100));
             }
        }

        if (this.isInitialized && this.browser) {
            this.logger.info("Closing Playwright browser...");
            try {
                await this.browser.close();
                this.logger.info("Playwright browser closed successfully.");
            } catch (error) {
                this.logger.error({ err: error }, "Error closing Playwright browser.");
                // Decide if you need to throw here
            } finally {
                this.browser = null;
                this.browserContext = null;
                this.isInitialized = false;
            }
        } else {
             this.logger.info("Playwright browser was not initialized or already closed.");
        }
    }
}