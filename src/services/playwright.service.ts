// src/services/playwright.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { chromium, Browser, BrowserContext, Route, Request, BrowserType } from "playwright"; // Added BrowserType for channel typing
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../utils/errorUtils'; // Import the error utility

/**
 * Service responsible for initializing, managing, and closing Playwright browser instances.
 * It provides a configured browser context for web scraping operations,
 * including request interception for performance and stealth.
 */
@singleton()
export class PlaywrightService {
    private browser: Browser | null = null;
    private browserContext: BrowserContext | null = null;
    private readonly serviceBaseLogger: Logger;
    private isInitialized = false; // Flag to indicate if browser and context are successfully initialized
    private isInitializing = false; // Flag to prevent multiple concurrent initializations

    // --- Playwright Configuration Properties from ConfigService ---
    private readonly PLAYWRIGHT_CHANNEL: string | undefined; // e.g., 'chrome', 'msedge'
    private readonly PLAYWRIGHT_HEADLESS: boolean; // Whether to run browser in headless mode
    private readonly USER_AGENT: string | undefined; // Custom user agent string

    /**
     * Constructs an instance of PlaywrightService.
     * Injects LoggingService and ConfigService to retrieve configurations.
     * @param {LoggingService} loggingService - The injected logging service.
     * @param {ConfigService} configService - The injected configuration service.
     */
    constructor(
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(ConfigService) private configService: ConfigService
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger('main', { service: 'PlaywrightServiceBase' });

        // Load Playwright-specific configurations from ConfigService
        this.PLAYWRIGHT_CHANNEL = this.configService.config.PLAYWRIGHT_CHANNEL;
        this.PLAYWRIGHT_HEADLESS = this.configService.config.PLAYWRIGHT_HEADLESS === true; // Ensure boolean
        this.USER_AGENT = this.configService.config.USER_AGENT;

        this.serviceBaseLogger.info(
            { event: 'playwright_service_init_constructor', channel: this.PLAYWRIGHT_CHANNEL, headless: this.PLAYWRIGHT_HEADLESS },
            "PlaywrightService instance created and configurations loaded."
        );
    }

    /**
     * Helper method to create a child logger for specific methods.
     * @param {Logger | undefined} parentLogger - An optional parent logger.
     * @param {string} methodName - The name of the method for logger context.
     * @returns {Logger} A new logger instance with bound context.
     */
    private getMethodLogger(parentLogger: Logger | undefined, methodName: string): Logger {
        const base = parentLogger || this.serviceBaseLogger;
        return base.child({ serviceMethod: `PlaywrightService.${methodName}` });
    }

    /**
     * Initializes the Playwright browser and a new browser context.
     * This method ensures that initialization only happens once and handles concurrent calls.
     * It also configures request interception to block unnecessary resources.
     * @param {Logger} [parentLogger] - An optional parent logger for contextual logging.
     * @returns {Promise<void>} A Promise that resolves when initialization is complete.
     * @throws {Error} If critical Playwright configurations are missing or initialization fails.
     */
    async initialize(parentLogger?: Logger): Promise<void> {
        const logger = this.getMethodLogger(parentLogger, 'initialize');

        if (this.isInitialized) {
            logger.debug({ event: 'playwright_already_initialized' }, "Playwright is already initialized. Skipping initialization.");
            return;
        }

        // Handle concurrent initialization attempts
        if (this.isInitializing) {
            logger.debug({ event: 'playwright_initializing_wait' }, "Playwright is currently initializing. Waiting for completion...");
            // Wait until initialization is complete
            while (this.isInitializing) {
                await new Promise(resolve => setTimeout(resolve, 100)); // Poll every 100ms
            }
            if (this.isInitialized) {
                logger.debug({ event: 'playwright_initializing_completed_by_other' }, "Playwright initialization completed by another concurrent call.");
                return;
            }
            // Fallback if initialization by another call failed or didn't complete as expected
            logger.warn({ event: 'playwright_initializing_other_failed' }, "Concurrent Playwright initialization did not complete successfully. Proceeding with current call.");
        }

        this.isInitializing = true; // Set flag to true to indicate initialization is in progress
        logger.info({ event: 'playwright_initialize_start' }, "Starting Playwright browser and context initialization...");

        // --- Validate required configurations before launching browser ---
        if (!this.PLAYWRIGHT_CHANNEL || this.PLAYWRIGHT_HEADLESS === undefined || !this.USER_AGENT) {
            const errorMsg = "Critical Playwright configuration(s) are missing (PLAYWRIGHT_CHANNEL, PLAYWRIGHT_HEADLESS, or USER_AGENT).";
            logger.fatal({
                event: 'playwright_config_missing_critical',
                missing: {
                    channel: !this.PLAYWRIGHT_CHANNEL,
                    headless: this.PLAYWRIGHT_HEADLESS === undefined,
                    userAgent: !this.USER_AGENT,
                }
            }, errorMsg);
            this.isInitializing = false; // Reset flag on critical config error
            throw new Error(errorMsg);
        }
        logger.info({
            channel: this.PLAYWRIGHT_CHANNEL,
            headless: this.PLAYWRIGHT_HEADLESS,
            userAgent: this.USER_AGENT?.substring(0, 50) + '...' // Log a snippet of User-Agent
        }, "Playwright configurations validated for setup.");

        let tempBrowser: Browser | null = null; // Temporary variable to hold browser instance during setup

        try {
            // Launch Chromium browser
            tempBrowser = await chromium.launch({
                channel: this.PLAYWRIGHT_CHANNEL,
                headless: this.PLAYWRIGHT_HEADLESS,
                args: [
                    "--disable-notifications",
                    "--disable-geolocation",
                    "--disable-extensions",
                    "--no-sandbox", // Required for Docker environments
                    "--disable-setuid-sandbox", // Required for Docker environments
                    "--disable-gpu", // Often good practice in headless environments
                    "--blink-settings=imagesEnabled=false", // Disable images for performance
                    "--ignore-certificate-errors", // Ignore SSL certificate errors
                    "--disable-dev-shm-usage" // For Docker: Prevents shared memory issues
                ],
                // slowMo: 50, // Optional: for debugging, slows down operations by 50ms
                timeout: 30000 // 30 seconds for browser launch
            });
            logger.debug({ event: 'browser_launched' }, "Playwright browser launched.");

            // Create a new browser context with specific permissions and settings
            const tempBrowserContext: BrowserContext = await tempBrowser.newContext({
                permissions: [], // Deny all permissions by default
                viewport: { width: 1280, height: 720 }, // Standard viewport size
                ignoreHTTPSErrors: true, // Ignore HTTPS errors for all pages in this context
                extraHTTPHeaders: { 'Upgrade-Insecure-Requests': '1' }, // Request HTTPS upgrades
                userAgent: this.USER_AGENT, // Set custom user agent
                javaScriptEnabled: true, // Enable JavaScript
                bypassCSP: true, // Bypass Content Security Policy for easier scraping
            });
            logger.debug({ event: 'browser_context_created' }, "Playwright browser context created.");

            // Configure request interception to block unnecessary resources and improve performance
            await tempBrowserContext.route("**/*", (route: Route) => {
                try {
                    const request: Request = route.request();
                    const resourceType: ReturnType<Request['resourceType']> = request.resourceType();
                    const url = request.url();

                    // Block common resource types and tracking domains
                    if (
                        ["image", "media", "font", "stylesheet"].includes(resourceType) ||
                        url.includes("google-analytics") ||
                        url.includes("googletagmanager") ||
                        url.includes("googleadservices") ||
                        url.includes("doubleclick.net") ||
                        url.includes("ads") ||
                        url.includes("tracking") ||
                        url.endsWith(".css") || // Explicitly block all CSS files if not already covered by 'stylesheet'
                        url.endsWith(".svg") || // Often unneeded images
                        url.endsWith(".webp") ||
                        url.endsWith(".gif") ||
                        url.endsWith(".png") ||
                        url.endsWith(".jpg") ||
                        url.endsWith(".jpeg")
                    ) {
                        logger.trace({ event: 'route_blocked', url, resourceType }, `Blocking resource: ${resourceType} from ${url}`);
                        // Use .catch() to handle potential errors if abort() fails
                        route.abort().catch(e => {
                            const { message: errMsg } = getErrorMessageAndStack(e);
                            logger.warn({ err: errMsg, url: request.url(), event: 'route_abort_error' }, `Error aborting route for ${request.url()}: ${errMsg}`);
                        });
                    } else {
                        logger.trace({ event: 'route_continued', url, resourceType }, `Continuing resource: ${resourceType} from ${url}`);
                        // Use .catch() to handle potential errors if continue() fails
                        route.continue().catch(e => {
                            const { message: errMsg } = getErrorMessageAndStack(e);
                            logger.warn({ err: errMsg, url: request.url(), event: 'route_continue_error' }, `Error continuing route for ${request.url()}: ${errMsg}`);
                        });
                    }
                } catch (routeError: unknown) { // Catch as unknown
                    const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(routeError);
                    logger.error({ err: { message: errorMessage, stack: errorStack }, event: 'playwright_route_handling_error' }, `Critical error during Playwright route handling: "${errorMessage}". Attempting to continue route.`);
                    // Always try to continue the route if an error occurs in handling to prevent deadlock
                    route.continue().catch(e => {
                        const { message: errMsg } = getErrorMessageAndStack(e);
                        logger.warn({ err: errMsg, event: 'playwright_route_continue_after_catch_error' }, `Error continuing route after critical error: ${errMsg}`);
                    });
                }
            });
            logger.debug({ event: 'request_interception_configured' }, "Playwright request interception configured.");

            // Assign the successfully created instances to service properties
            this.browser = tempBrowser;
            this.browserContext = tempBrowserContext;
            this.isInitialized = true; // Mark as successfully initialized
            logger.info({ event: 'playwright_initialize_success' }, "Playwright browser and context initialized successfully.");

        } catch (error: unknown) { // Catch any errors during launch or context creation
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.fatal({ err: { message: errorMessage, stack: errorStack }, event: 'playwright_initialize_failed' }, `Fatal error: Failed to initialize Playwright browser: "${errorMessage}".`);

            // Attempt to close the browser if it was partially launched
            if (tempBrowser) {
                await tempBrowser.close().catch(closeError => {
                    const { message: closeErrMsg, stack: closeErrStack } = getErrorMessageAndStack(closeError);
                    logger.error({ err: { message: closeErrMsg, stack: closeErrStack }, event: 'playwright_browser_close_after_failure_error' }, "Error closing browser after launch failure.");
                });
            }
            // Reset service properties to a clean state on failure
            this.browser = null;
            this.browserContext = null;
            this.isInitialized = false; // Ensure flag is false on failure
            throw error; // Re-throw the original error to signal failure to the caller
        } finally {
            this.isInitializing = false; // Always reset initializing flag
        }
    }

    /**
     * Retrieves the active Playwright BrowserContext.
     * This context can be used to create new pages and perform scraping operations.
     * @param {Logger} [parentLogger] - An optional parent logger for contextual logging.
     * @returns {BrowserContext} The active Playwright BrowserContext.
     * @throws {Error} If the BrowserContext has not been successfully initialized.
     */
    getBrowserContext(parentLogger?: Logger): BrowserContext {
        const logger = this.getMethodLogger(parentLogger, 'getBrowserContext');

        if (!this.isInitialized || !this.browserContext) {
            const errorMsg = "Playwright browser context requested before successful initialization or initialization failed.";
            logger.error({ event: 'playwright_context_unavailable_error', reason: errorMsg }, errorMsg);
            throw new Error(errorMsg);
        }
        logger.trace({ event: 'playwright_context_provided' }, "Playwright browser context provided.");
        return this.browserContext;
    }

    /**
     * Closes the Playwright browser instance and releases all associated resources.
     * This method handles cases where Playwright is still initializing or already closed.
     * @param {Logger} [parentLogger] - An optional parent logger for contextual logging.
     * @returns {Promise<void>} A Promise that resolves when the browser is successfully closed.
     */
    async close(parentLogger?: Logger): Promise<void> {
        const logger = this.getMethodLogger(parentLogger, 'close');

        // If currently initializing, wait for it to complete
        if (this.isInitializing) {
            logger.warn({ event: 'playwright_close_while_initializing' }, "Attempting to close Playwright while it is still initializing. Waiting for initialization to finish...");
            while (this.isInitializing) {
                await new Promise(resolve => setTimeout(resolve, 100)); // Poll
            }
            // After waiting, check if initialization succeeded or failed
            if (!this.isInitialized) {
                logger.warn({ event: 'playwright_close_init_failed_after_wait' }, "Playwright initialization did not complete successfully. Nothing to close regarding browser instance.");
                // Ensure state is clean even if it failed to initialize
                this.browser = null;
                this.browserContext = null;
                this.isInitialized = false;
                return;
            }
        }

        // Proceed to close if initialized and browser instance exists
        if (this.isInitialized && this.browser) {
            logger.info({ event: 'playwright_close_start' }, "Closing Playwright browser...");
            try {
                await this.browser.close();
                logger.info({ event: 'playwright_close_success' }, "Playwright browser closed successfully.");
            } catch (error: unknown) { // Catch as unknown
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
                logger.error({ err: { message: errorMessage, stack: errorStack }, event: 'playwright_close_failed' }, `Error closing Playwright browser: "${errorMessage}".`);
            } finally {
                // Always reset state regardless of close success or failure
                this.browser = null;
                this.browserContext = null;
                this.isInitialized = false;
            }
        } else {
            // Log if no browser instance to close
            if (!this.isInitialized && !this.isInitializing) {
                logger.info({ event: 'playwright_close_skipped_not_initialized' }, "Playwright browser was not initialized or already closed. No action taken.");
            } else if (this.browser && !this.isInitialized) {
                // Edge case: browser exists but isInitialized is false (e.g., partial init failure)
                 logger.warn({ event: 'playwright_close_partial_state_detected' }, "Playwright browser instance found but service not marked as initialized. Attempting to force close.");
                 try {
                    await this.browser.close();
                 } catch (e: unknown) {
                    const { message: errMsg, stack: errStack } = getErrorMessageAndStack(e);
                    logger.error({ err: { message: errMsg, stack: errStack }, event: 'playwright_close_force_failed' }, `Error forcefully closing browser: "${errMsg}".`);
                 } finally {
                    this.browser = null;
                    this.browserContext = null;
                    this.isInitialized = false;
                 }
            }
        }
    }
}