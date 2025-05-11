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
    private readonly serviceBaseLogger: Logger; // Logger cơ sở của service
    private isInitialized = false;
    private isInitializing = false; // Cờ để xử lý các cuộc gọi đồng thời đến initialize

    constructor(@inject(LoggingService) private loggingService: LoggingService) {
        this.serviceBaseLogger = this.loggingService.getLogger({ service: 'PlaywrightServiceBase' });
        this.serviceBaseLogger.info("PlaywrightService initialized (constructor).");
    }

    // Helper để tạo logger cho phương thức với context từ parentLogger
    private getMethodLogger(parentLogger: Logger | undefined, methodName: string): Logger {
        const base = parentLogger || this.serviceBaseLogger;
        return base.child({ serviceMethod: `PlaywrightService.${methodName}` });
    }

    // Khởi tạo trình duyệt và context (chỉ chạy 1 lần)
    async initialize(parentLogger?: Logger): Promise<void> {
        const logger = this.getMethodLogger(parentLogger, 'initialize');

        if (this.isInitialized) {
            logger.debug("Playwright already initialized. Skipping.");
            return;
        }

        if (this.isInitializing) {
            logger.debug("Playwright is already initializing. Waiting for completion...");
            while (this.isInitializing) {
                await new Promise(resolve => setTimeout(resolve, 100)); // Chờ cho tiến trình khác hoàn thành
            }
            if (this.isInitialized) {
                 logger.debug("Playwright initialization completed by another call.");
                 return;
            }
            // Nếu sau khi chờ mà vẫn chưa init (có thể do lỗi ở lần init kia) -> thử init lại
            logger.warn("Initialization by another call did not complete. Proceeding with current call.");
        }

        this.isInitializing = true;
        logger.info("Initializing Playwright browser...");
        try {
            const { browser, browserContext } = await setupPlaywright(); // Gọi hàm gốc
            this.browser = browser;
            this.browserContext = browserContext;
            this.isInitialized = true;
            logger.info("Playwright browser initialized successfully.");
        } catch (error) {
            logger.fatal({ err: error }, "Failed to initialize Playwright browser.");
            // Sau khi lỗi, isInitialized vẫn là false, isInitializing sẽ được set false ở finally
            throw error;
        } finally {
            this.isInitializing = false;
        }
    }

    // Lấy browser context (phải gọi initialize trước)
    getBrowserContext(parentLogger?: Logger): BrowserContext {
        // Nếu có parentLogger, dùng nó để log lỗi, nếu không dùng serviceBaseLogger
        const logger = this.getMethodLogger(parentLogger, 'getBrowserContext');

        if (!this.isInitialized || !this.browserContext) {
            const errorMsg = "Playwright browser context requested before successful initialization or initialization failed.";
            logger.error(errorMsg); // Log với context của request (nếu có)
            throw new Error(errorMsg);
        }
        return this.browserContext;
    }

    // Đóng trình duyệt
    async close(parentLogger?: Logger): Promise<void> {
        const logger = this.getMethodLogger(parentLogger, 'close');

        if (this.isInitializing) {
            logger.warn("Attempting to close Playwright while it is still initializing. Waiting for initialization to finish...");
            while (this.isInitializing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            // Sau khi chờ, kiểm tra lại trạng thái
            if (!this.isInitialized) {
                logger.warn("Playwright initialization did not complete. Nothing to close regarding browser instance.");
                this.browser = null; // Đảm bảo các biến được reset
                this.browserContext = null;
                this.isInitialized = false; // Đảm bảo trạng thái đúng
                return;
            }
        }

        if (this.isInitialized && this.browser) {
            logger.info("Closing Playwright browser...");
            try {
                await this.browser.close();
                logger.info("Playwright browser closed successfully.");
            } catch (error) {
                logger.error({ err: error }, "Error closing Playwright browser.");
                // Không ném lỗi ở đây thường là tốt, nhưng tùy vào yêu cầu
            } finally {
                this.browser = null;
                this.browserContext = null;
                this.isInitialized = false; // Reset trạng thái
            }
        } else {
            if (!this.isInitialized && !this.isInitializing) { // Chỉ log nếu không phải đang init hoặc đã init
                 logger.info("Playwright browser was not initialized or already closed. No action taken.");
            }
        }
    }
}