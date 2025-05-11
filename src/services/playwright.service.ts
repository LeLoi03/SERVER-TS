// src/services/playwright.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { chromium, Browser, BrowserContext, Route, Request } from "playwright"; // Added Playwright core imports
import { ConfigService } from '../config/config.service'; // Added ConfigService import
import { LoggingService } from './logging.service';
import { Logger } from 'pino';

@singleton()
export class PlaywrightService {
    private browser: Browser | null = null;
    private browserContext: BrowserContext | null = null;
    private readonly serviceBaseLogger: Logger;
    private isInitialized = false;
    private isInitializing = false;

    // --- Playwright Config Properties ---
    private readonly PLAYWRIGHT_CHANNEL: string | undefined;
    private readonly PLAYWRIGHT_HEADLESS: boolean | undefined;
    private readonly USER_AGENT: string | undefined;

    constructor(
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(ConfigService) private configService: ConfigService // Inject ConfigService
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger({ service: 'PlaywrightServiceBase' });

        // --- Lấy cấu hình từ ConfigService ---
        this.PLAYWRIGHT_CHANNEL = this.configService.config.PLAYWRIGHT_CHANNEL;
        this.PLAYWRIGHT_HEADLESS = this.configService.config.PLAYWRIGHT_HEADLESS === true; // Ensure boolean
        this.USER_AGENT = this.configService.config.USER_AGENT;

        this.serviceBaseLogger.info("PlaywrightService initialized (constructor). Config loaded.");
    }

    private getMethodLogger(parentLogger: Logger | undefined, methodName: string): Logger {
        const base = parentLogger || this.serviceBaseLogger;
        return base.child({ serviceMethod: `PlaywrightService.${methodName}` });
    }

    async initialize(parentLogger?: Logger): Promise<void> {
        const logger = this.getMethodLogger(parentLogger, 'initialize');

        if (this.isInitialized) {
            logger.debug("Playwright already initialized. Skipping.");
            return;
        }

        if (this.isInitializing) {
            logger.debug("Playwright is already initializing. Waiting for completion...");
            while (this.isInitializing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (this.isInitialized) {
                logger.debug("Playwright initialization completed by another call.");
                return;
            }
            logger.warn("Initialization by another call did not complete. Proceeding with current call.");
        }

        this.isInitializing = true;
        logger.info("Initializing Playwright browser...");

        // --- Check for required configurations ---
        if (!this.PLAYWRIGHT_CHANNEL || this.PLAYWRIGHT_HEADLESS === undefined || !this.USER_AGENT) {
            const errorMsg = "Playwright configuration (PLAYWRIGHT_CHANNEL, PLAYWRIGHT_HEADLESS, USER_AGENT) is not fully set.";
            logger.fatal({
                event: 'playwright_config_missing',
                missing: {
                    channel: !this.PLAYWRIGHT_CHANNEL,
                    headless: this.PLAYWRIGHT_HEADLESS === undefined,
                    userAgent: !this.USER_AGENT,
                }
            }, errorMsg);
            this.isInitializing = false; // Reset flag
            throw new Error(errorMsg);
        }
        logger.info({
            channel: this.PLAYWRIGHT_CHANNEL,
            headless: this.PLAYWRIGHT_HEADLESS,
            userAgent: this.USER_AGENT
        }, "Playwright configuration loaded for setup.");


        // --- Start of merged setupPlaywright logic ---
        let tempBrowser: Browser | null = null; // Use a temporary variable for browser within this scope

        try {
            tempBrowser = await chromium.launch({
                channel: this.PLAYWRIGHT_CHANNEL as any, // Cast as any if type issues, or ensure PLAYWRIGHT_CHANNEL is of correct type
                headless: this.PLAYWRIGHT_HEADLESS,
                args: [
                    "--disable-notifications",
                    "--disable-geolocation",
                    "--disable-extensions",
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-gpu",
                    "--blink-settings=imagesEnabled=false",
                    "--ignore-certificate-errors",
                ],
            });

            const tempBrowserContext: BrowserContext = await tempBrowser.newContext({
                permissions: [],
                viewport: { width: 1280, height: 720 },
                ignoreHTTPSErrors: true,
                extraHTTPHeaders: { 'Upgrade-Insecure-Requests': '1' },
                userAgent: this.USER_AGENT,
                javaScriptEnabled: true,
                bypassCSP: true,
            });

            await tempBrowserContext.route("**/*", (route: Route) => {
                try {
                    const request: Request = route.request();
                    const resourceType: ReturnType<Request['resourceType']> = request.resourceType();

                    if (
                        ["image", "media", "font", "stylesheet"].includes(resourceType) ||
                        request.url().includes("google-analytics") ||
                        request.url().includes("googletagmanager") ||
                        request.url().includes("googleadservices") ||
                        request.url().includes("doubleclick.net") ||
                        request.url().includes("ads") ||
                        request.url().includes("tracking") ||
                        request.url().endsWith(".css")
                    ) {
                        route.abort().catch(e => logger.warn({ err: e, url: request.url() }, `Error aborting route`));
                    } else {
                        route.continue().catch(e => logger.warn({ err: e, url: request.url() }, `Error continuing route`));
                    }
                } catch (routeError: unknown) {
                    const errorMsg = routeError instanceof Error ? routeError.message : String(routeError);
                    logger.error({ err: routeError, event: 'playwright_route_handling_error' }, `Error handling route: ${errorMsg}`);
                    route.continue().catch(e => logger.warn({ err: e, event: 'playwright_route_continue_after_catch_error' }, `Error continuing route after catch`));
                }
            });

            // Assign to service properties on success
            this.browser = tempBrowser;
            this.browserContext = tempBrowserContext;
            this.isInitialized = true;
            logger.info({ event: 'playwright_setup_success' }, "Playwright browser and context initialized successfully.");

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.fatal({ err: error, event: 'playwright_setup_failed' }, `Failed to initialize Playwright browser: ${errorMsg}`);
            if (error instanceof Error && error.stack) {
                logger.error({ stack: error.stack }, "Playwright initialization error stack trace");
            }

            if (tempBrowser) {
                await tempBrowser.close().catch(closeError =>
                    logger.error({ err: closeError, event: 'playwright_browser_close_after_failure_error' }, "Error closing browser after launch failure.")
                );
            }
            // Reset service properties if they were partially set or to ensure clean state
            this.browser = null;
            this.browserContext = null;
            this.isInitialized = false; // Ensure this is false on failure
            // isInitializing will be set to false in finally
            throw error; // Re-throw the error to signal failure to the caller
        } finally {
            this.isInitializing = false;
        }
        // --- End of merged setupPlaywright logic ---
    }

    getBrowserContext(parentLogger?: Logger): BrowserContext {
        const logger = this.getMethodLogger(parentLogger, 'getBrowserContext');

        if (!this.isInitialized || !this.browserContext) {
            const errorMsg = "Playwright browser context requested before successful initialization or initialization failed.";
            logger.error({ event: 'playwright_context_unavailable', reason: errorMsg }, errorMsg);
            throw new Error(errorMsg);
        }
        return this.browserContext;
    }

    async close(parentLogger?: Logger): Promise<void> {
        const logger = this.getMethodLogger(parentLogger, 'close');

        if (this.isInitializing) {
            logger.warn("Attempting to close Playwright while it is still initializing. Waiting for initialization to finish...");
            while (this.isInitializing) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            if (!this.isInitialized) { // Check again after waiting
                logger.warn("Playwright initialization did not complete. Nothing to close regarding browser instance.");
                this.browser = null;
                this.browserContext = null;
                this.isInitialized = false;
                return;
            }
        }

        if (this.isInitialized && this.browser) {
            logger.info("Closing Playwright browser...");
            try {
                await this.browser.close();
                logger.info({ event: 'playwright_browser_closed_success' }, "Playwright browser closed successfully.");
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                logger.error({ err: error, event: 'playwright_close_failed' }, `Error closing Playwright browser: ${errorMsg}`);
            } finally {
                this.browser = null;
                this.browserContext = null;
                this.isInitialized = false;
            }
        } else {
            if (!this.isInitialized && !this.isInitializing) {
                logger.info("Playwright browser was not initialized or already closed. No action taken.");
            }
        }
    }
}
