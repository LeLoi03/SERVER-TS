// scrape.js

// --- Dependencies ---
// Chúng ta cần playwright và một logger đơn giản (có thể dùng console)
const { chromium } = require("playwright");

// --- Mock/Giả lập các Service phụ thuộc ---

/**
 * Mock cho LoggingService.
 * Cung cấp một logger đơn giản sử dụng console.log.
 */
class MockLoggingService {
    getLogger(name, options) {
        // Trả về một đối tượng logger có các phương thức mà PlaywrightService sử dụng
        const logger = {
            info: (obj, msg) => console.log(`[INFO] ${msg || obj}`),
            debug: (obj, msg) => console.log(`[DEBUG] ${msg || obj}`),
            warn: (obj, msg) => console.warn(`[WARN] ${msg || obj}`),
            error: (obj, msg) => console.error(`[ERROR] ${msg || obj}`),
            fatal: (obj, msg) => console.error(`[FATAL] ${msg || obj}`),
            trace: (obj, msg) => {}, // Bỏ qua trace cho đơn giản
            child: () => logger, // Phương thức child() trả về chính nó
        };
        return logger;
    }
}

/**
 * Mock cho ConfigService.
 * Cung cấp các giá trị cấu hình cứng cho Playwright.
 */
class MockConfigService {
    constructor() {
        this.playwrightConfig = {
            channel: 'msedge', // 'chrome', 'msedge', 'firefox'
            headless: true,    // Chạy ở chế độ không giao diện
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0',
        };
    }
}

/**
 * Mock cho errorUtils.
 */
function getErrorMessageAndStack(error) {
    return {
        message: error.message || 'Unknown error',
        stack: error.stack || '',
    };
}


// --- Phiên bản JavaScript của PlaywrightService của bạn ---
// (Đã loại bỏ TypeScript, decorators, và sử dụng require)

class PlaywrightService {
    constructor(loggingService, configService) {
        this.loggingService = loggingService;
        this.configService = configService;
        this.browser = null;
        this.browserContext = null;
        this.serviceBaseLogger = this.loggingService.getLogger('conference', { service: 'PlaywrightServiceBase' });
        this.isInitialized = false;
        this.isInitializing = false;

        this.PLAYWRIGHT_CHANNEL = this.configService.playwrightConfig.channel;
        this.PLAYWRIGHT_HEADLESS = this.configService.playwrightConfig.headless === true;
        this.USER_AGENT = this.configService.playwrightConfig.userAgent;

        this.serviceBaseLogger.info(
            { event: 'playwright_service_init_constructor', channel: this.PLAYWRIGHT_CHANNEL, headless: this.PLAYWRIGHT_HEADLESS },
            "PlaywrightService instance created and configurations loaded."
        );
    }

    getMethodLogger(parentLogger, methodName) {
        const base = parentLogger || this.serviceBaseLogger;
        return base.child({ serviceMethod: `PlaywrightService.${methodName}` });
    }

    async initialize(parentLogger) {
        const logger = this.getMethodLogger(parentLogger, 'initialize');

        if (this.isInitialized) {
            logger.debug({ event: 'playwright_already_initialized' }, "Playwright is already initialized. Skipping initialization.");
            return;
        }

        if (this.isInitializing) {
            logger.debug({ event: 'playwright_initializing_wait' }, "Playwright is currently initializing. Waiting for completion...");
            while (this.isInitializing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (this.isInitialized) {
                logger.debug({ event: 'playwright_initializing_completed_by_other' }, "Playwright initialization completed by another concurrent call.");
                return;
            }
            logger.warn({ event: 'playwright_initializing_other_failed' }, "Concurrent Playwright initialization did not complete successfully. Proceeding with current call.");
        }

        this.isInitializing = true;
        logger.info({ event: 'playwright_initialize_start' }, "Starting Playwright browser and context initialization...");

        if (!this.PLAYWRIGHT_CHANNEL || this.PLAYWRIGHT_HEADLESS === undefined || !this.USER_AGENT) {
            const errorMsg = "Critical Playwright configuration(s) are missing (PLAYWRIGHT_CHANNEL, PLAYWRIGHT_HEADLESS, or USER_AGENT).";
            logger.fatal({}, errorMsg);
            this.isInitializing = false;
            throw new Error(errorMsg);
        }

        let tempBrowser = null;

        try {
            tempBrowser = await chromium.launch({
                channel: this.PLAYWRIGHT_CHANNEL,
                headless: this.PLAYWRIGHT_HEADLESS,
                args: [
                    "--disable-notifications", "--disable-geolocation", "--disable-extensions",
                    "--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu",
                    "--blink-settings=imagesEnabled=false", "--ignore-certificate-errors",
                    "--disable-dev-shm-usage"
                ],
                timeout: 30000
            });
            logger.debug({ event: 'browser_launched' }, "Playwright browser launched.");

            const tempBrowserContext = await tempBrowser.newContext({
                permissions: [],
                viewport: { width: 1280, height: 720 },
                ignoreHTTPSErrors: true,
                extraHTTPHeaders: { 'Upgrade-Insecure-Requests': '1' },
                userAgent: this.USER_AGENT,
                javaScriptEnabled: true,
                bypassCSP: true,
            });
            logger.debug({ event: 'browser_context_created' }, "Playwright browser context created.");

            await tempBrowserContext.route("**/*", (route) => {
                try {
                    const request = route.request();
                    const resourceType = request.resourceType();
                    const url = request.url();

                    // if (
                    //     ["image", "media", "font", "stylesheet"].includes(resourceType) ||
                    //     url.includes("google-analytics") || url.includes("googletagmanager") ||
                    //     url.includes("doubleclick.net") || url.endsWith(".css")
                    // ) {
                    //     route.abort().catch(e => {});
                    // } else {
                        route.continue().catch(e => {});
                    // }
                } catch (routeError) {
                    const { message: errorMessage } = getErrorMessageAndStack(routeError);
                    logger.error({ err: { message: errorMessage }, event: 'playwright_route_handling_error' }, `Critical error during Playwright route handling: "${errorMessage}".`);
                    route.continue().catch(e => {});
                }
            });
            logger.debug({ event: 'request_interception_configured' }, "Playwright request interception configured.");

            this.browser = tempBrowser;
            this.browserContext = tempBrowserContext;
            this.isInitialized = true;
            logger.info({ event: 'playwright_initialize_success' }, "Playwright browser and context initialized successfully.");

        } catch (error) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.fatal({ err: { message: errorMessage, stack: errorStack }, event: 'playwright_initialize_failed' }, `Fatal error: Failed to initialize Playwright browser: "${errorMessage}".`);
            if (tempBrowser) {
                await tempBrowser.close().catch(e => {});
            }
            this.browser = null;
            this.browserContext = null;
            this.isInitialized = false;
            throw error;
        } finally {
            this.isInitializing = false;
        }
    }

    getBrowserContext(parentLogger) {
        const logger = this.getMethodLogger(parentLogger, 'getBrowserContext');
        if (!this.isInitialized || !this.browserContext) {
            const errorMsg = "Playwright browser context requested before successful initialization or initialization failed.";
            logger.error({ event: 'playwright_context_unavailable_error' }, errorMsg);
            throw new Error(errorMsg);
        }
        return this.browserContext;
    }

    async close(parentLogger) {
        const logger = this.getMethodLogger(parentLogger, 'close');
        if (this.isInitializing) {
            logger.warn({ event: 'playwright_close_while_initializing' }, "Attempting to close Playwright while it is still initializing...");
            while (this.isInitializing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        if (this.isInitialized && this.browser) {
            logger.info({ event: 'playwright_close_start' }, "Closing Playwright browser...");
            try {
                await this.browser.close();
                logger.info({ event: 'playwright_close_success' }, "Playwright browser closed successfully.");
            } catch (error) {
                const { message: errorMessage } = getErrorMessageAndStack(error);
                logger.error({ err: { message: errorMessage }, event: 'playwright_close_failed' }, `Error closing Playwright browser: "${errorMessage}".`);
            } finally {
                this.browser = null;
                this.browserContext = null;
                this.isInitialized = false;
            }
        } else {
            logger.info({ event: 'playwright_close_skipped_not_initialized' }, "Playwright browser was not initialized or already closed.");
        }
    }
}


// --- Logic chính để chạy kịch bản ---

async function main() {
    // 1. Khởi tạo các service mock
    const loggingService = new MockLoggingService();
    const configService = new MockConfigService();

    // 2. Khởi tạo PlaywrightService với các mock service
    const playwrightService = new PlaywrightService(loggingService, configService);

    // Sử dụng try...finally để đảm bảo trình duyệt luôn được đóng
    try {
        console.log("--- Bắt đầu kịch bản cào dữ liệu ---");

        // 3. Khởi tạo trình duyệt thông qua service
        await playwrightService.initialize();

        // 4. Lấy context của trình duyệt
        const context = playwrightService.getBrowserContext();

        // 5. Mở một trang mới
        const page = await context.newPage();
        console.log("Đã mở trang mới.");

        // 6. Truy cập vào URL mục tiêu
        const url = 'https://algo-conference.org/2025/atmos/';
        console.log(`Đang truy cập: ${url}`);
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        console.log("Tải trang thành công.");

        // 7. Lấy toàn bộ text từ thẻ <body> của trang
        // page.locator('body').innerText() sẽ lấy tất cả text mà người dùng có thể thấy
        const pageText = await page.locator('body').innerText();

        console.log("\n--- TOÀN BỘ TEXT CỦA TRANG ---");
        console.log(pageText);
        console.log("--- KẾT THÚC TEXT CỦA TRANG ---\n");

    } catch (error) {
        console.error("Đã xảy ra lỗi trong quá trình thực thi:", error);
    } finally {
        // 8. Đóng trình duyệt và giải phóng tài nguyên
        console.log("--- Đóng Playwright Service ---");
        await playwrightService.close();
        console.log("--- Kịch bản đã hoàn tất ---");
    }
}

// Chạy hàm main
main();