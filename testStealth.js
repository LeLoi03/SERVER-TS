// testStealth.ts
import { chromium as playwrightVanilla } from 'playwright'; // Playwright gốc
import { chromium as playwrightExtra } from 'playwright-extra'; // Playwright-extra
import stealth from 'puppeteer-extra-plugin-stealth'; // Plugin stealth
import pino from 'pino'; // Để mô phỏng logger của bạn

// URL để test (thử thay đổi giữa wads.org và sigsim.acm.org)
const TEST_URL = 'https://www.wads.org/'; 
// const TEST_URL = 'https://sigsim.acm.org/conf/pads/2024/';

// Tạo một logger đơn giản để mô phỏng cách bạn dùng
const logger = pino({
    level: 'info',
    transport: {
        target: 'pino-pretty'
    }
});

/**
 * Hàm trợ giúp để truy cập URL và lấy HTML, có thể bật/tắt stealth mode.
 */
async function testAccessUrl(useStealth) {
    let browser;
    let context;
    let page;
    let success = false;
    let textLength = 0;
    let errorMessage = '';

    logger.info(`--- Testing with ${useStealth ? 'STEALTH MODE ENABLED' : 'VANILLA PLAYWRIGHT'} ---`);

    try {
        if (useStealth) {
            playwrightExtra.use(stealth()); // Áp dụng plugin stealth
            logger.info('Stealth plugin applied.');
            browser = await playwrightExtra.launch({ headless: true, channel: 'msedge' });
        } else {
            browser = await playwrightVanilla.launch({ headless: true, channel: 'msedge' });
        }

        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
            ignoreHTTPSErrors: true,
            javaScriptEnabled: true,
            bypassCSP: true,
        });

        page = await context.newPage();

        // Thử chặn một số tài nguyên để mô phỏng logic của bạn
        await context.route(url => {
            const resourceType = new URL(url).pathname.split('.').pop(); // Đơn giản hóa resourceType
            if (['font', 'media'].includes(resourceType || '') || url.includes('google-analytics')) {
                return false; // Trả về false để chặn (abort)
            }
            return true; // Trả về true để cho phép (continue)
        }, route => {
            if (!route.isIntercepted()) { // Kiểm tra xem đã bị chặn bởi hàm route phía trên chưa
                logger.trace(`Continuing: ${route.request().resourceType()} - ${route.request().url()}`);
                route.continue();
            } else {
                 logger.trace(`Blocking: ${route.request().resourceType()} - ${route.request().url()}`);
                 route.abort(); // Nếu đã bị chặn, abort request
            }
        });


        logger.info(`Attempting to navigate to: ${TEST_URL}`);
        const response = await page.goto(TEST_URL, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
        });

        // Mô phỏng waitForContentToRender (chỉ chờ chung chung nếu có)
        try {
            await Promise.race([
                page.waitForSelector('#app', { state: 'attached', timeout: 5000 }),
                page.waitForSelector('#root', { state: 'attached', timeout: 5000 }),
                page.waitForSelector('main', { state: 'attached', timeout: 5000 }),
                page.waitForSelector('.container', { state: 'attached', timeout: 5000 }),
            ]);
            logger.info('One of the common SPA selectors found or timed out after 5s (expected behavior if not SPA).');
        } catch (e) {
            logger.warn(`waitForContentToRender timed out: ${e.message}`);
        }

        // Mô phỏng waitForLoadState
        try {
            await Promise.race([
                page.waitForLoadState('networkidle', { timeout: 15000 }),
                page.waitForLoadState('load', { timeout: 15000 })
            ]);
            logger.info('Page load state (networkidle or load) achieved.');
        } catch (e) {
            logger.warn(`waitForLoadState timed out: ${e.message}`);
        }

        // Thêm khoảng chờ cuối cùng cho SPA (nếu cần thiết)
        logger.info('Adding a final 3-second wait for SPA rendering completion.');
        await page.waitForTimeout(3000);

        if (response && response.ok()) {
            success = true;
            const content = await page.content(); // Lấy toàn bộ HTML
            textLength = content.length;
            logger.info(`Successfully accessed URL. Final URL: ${page.url()}, Status: ${response.status()}, HTML Length: ${textLength}`);
        } else {
            errorMessage = `Response not OK. Status: ${response?.status() || 'N/A'}`;
            logger.error(`Failed to access URL: ${errorMessage}`);
        }

    } catch (error) {
        errorMessage = `Error: ${error.message}`;
        logger.error(`An error occurred: ${errorMessage}`);
    } finally {
        if (browser) {
            await browser.close();
            logger.info('Browser closed.');
        }
    }

    return { success, textLength, errorMessage };
}

// Chạy thử nghiệm
(async () => {
    // Chạy với Vanilla Playwright
    const resultVanilla = await testAccessUrl(false);
    logger.info(`Vanilla Playwright Result: Success: ${resultVanilla.success}, HTML Length: ${resultVanilla.textLength}, Error: ${resultVanilla.errorMessage}`);
    logger.info('\n');

    // Chạy với Stealth Mode
    const resultStealth = await testAccessUrl(true);
    logger.info(`Stealth Mode Playwright Result: Success: ${resultStealth.success}, HTML Length: ${resultStealth.textLength}, Error: ${resultStealth.errorMessage}`);
})();