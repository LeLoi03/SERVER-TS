// src/module/playwright_setup.ts
import { chromium, Browser, BrowserContext, Page } from "playwright";
// Lưu ý: Import từ file .ts (không cần đuôi file nếu tsconfig được cấu hình đúng)
import { CHANNEL, HEADLESS, USER_AGENT } from '../config';

import { PlaywrightSetupResult } from "./types";
 
export const setupPlaywright = async (): Promise<PlaywrightSetupResult> => {
    let browser: Browser | null = null; // Initialize to null, but allow Browser later

    try {
        browser = await chromium.launch({
            channel: CHANNEL,
            headless: HEADLESS, // Sử dụng biến HEADLESS từ config.ts
            args: [
                "--disable-notifications",
                "--disable-geolocation",
                "--disable-extensions",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-gpu",
                "--blink-settings=imagesEnabled=false", // Cân nhắc việc chặn ảnh ở đây hay ở context.route
                "--ignore-certificate-errors",
                "--disable-dev-shm-usage", // Thường hữu ích trong môi trường Docker/CI
                "--window-size=1280,720", // Đặt kích thước cửa sổ ở launch args cũng là một lựa chọn
            ],
        });

        const browserContext: BrowserContext = await browser.newContext({
            permissions: [], // Sử dụng mảng trống thay vì null nếu không cấp quyền cụ thể
            viewport: { width: 1280, height: 720 },
            ignoreHTTPSErrors: true,
            extraHTTPHeaders: { 'Upgrade-Insecure-Requests': '1' },
            userAgent: USER_AGENT,
            // Cân nhắc thêm các tùy chọn khác nếu cần:
            // locale: 'en-US',
            // timezoneId: 'America/New_York',
            // geolocation: { longitude: 12.4924, latitude: 41.8902 }, // Ví dụ: Rome
            acceptDownloads: true, // Cho phép tải file nếu cần
            javaScriptEnabled: true, // Mặc định là true, đảm bảo bật nếu cần JS
            bypassCSP: true, // Bỏ qua Content Security Policy nếu gặp sự cố
        });

        // // --- Phần chặn tài nguyên (giữ nguyên như comment hoặc bật lại nếu cần) ---
        // await browserContext.route("**/*", (route: Route) => {
        //     try {
        //         const request: Request = route.request();
        //         // Kiểu ResourceType được Playwright định nghĩa sẵn
        //         const resourceType: ReturnType<Request['resourceType']> = request.resourceType();

        //         if (
        //             ["image", "media", "font", "stylesheet"].includes(resourceType) || // Có thể thêm 'stylesheet' nếu không cần CSS
        //             request.url().includes("google-analytics") ||
        //             request.url().includes("googletagmanager") ||
        //             request.url().includes("googleadservices") ||
        //             request.url().includes("doubleclick.net") ||
        //             request.url().includes("ads") ||
        //             request.url().includes("tracking") ||
        //             request.url().endsWith(".css") // Chặn CSS cụ thể hơn nếu cần
        //         ) {
        //             route.abort().catch(e => console.error(`Error aborting route ${request.url()}:`, e)); // Thêm catch cho abort
        //         } else {
        //             route.continue().catch(e => console.error(`Error continuing route ${request.url()}:`, e)); // Thêm catch cho continue
        //         }
        //     } catch (routeError: unknown) { // Sử dụng unknown cho lỗi bắt được
        //         console.error("Error handling route:", routeError instanceof Error ? routeError.message : routeError);
        //         // Quyết định: Tiếp tục? Hủy bỏ với phản hồi mặc định?
        //         // route.continue() có lẽ là lựa chọn an toàn nhất
        //         route.continue().catch(e => console.error(`Error continuing route after catch:`, e));
        //     }
        // });
        // // --- Kết thúc phần chặn tài nguyên ---


        // Optional: Thêm xử lý lỗi trang để ghi log
        browserContext.on('page', (page: Page) => {
           page.on('crash', () => console.error(`Page crashed: ${page.url()}`));
           page.on('pageerror', (error) => console.error(`Page error in ${page.url()}:`, error));
           // page.on('requestfailed', request => console.log(`Request failed: ${request.url()}`)); // Ghi log request thất bại (nhiều log)
        });

        console.log("Playwright browser and context setup successfully.");
        return { browser, browserContext }; // Trả về cả browser và context

    } catch (launchError: unknown) { // Sử dụng unknown cho lỗi bắt được
        console.error("Error launching or configuring Playwright:", launchError instanceof Error ? launchError.message : launchError);
        if (launchError instanceof Error && launchError.stack) {
            console.error(launchError.stack);
        }
        // Đảm bảo đóng browser nếu nó đã được khởi tạo trước khi lỗi xảy ra ở phần newContext
        if (browser) {
            await browser.close().catch(closeError => console.error("Error closing browser after launch failure:", closeError));
        }
        return { browser: null, browserContext: null };
    }
};

// Hàm tiện ích để đóng trình duyệt (nên gọi khi kết thúc script)
export const closePlaywright = async (browser: Browser | null): Promise<void> => {
    if (browser) {
        try {
            await browser.close();
            console.log("Playwright browser closed successfully.");
        } catch (error: unknown) {
            console.error("Error closing Playwright browser:", error instanceof Error ? error.message : error);
        }
    }
};