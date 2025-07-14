import { Page, Response } from 'playwright';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../../utils/errorUtils';

/**
 * Kết quả trả về của hàm accessUrl.
 */
export interface AccessResult {
    success: boolean;
    finalUrl: string | null;
    response: Response | null;
    error: Error | null;
}

/**
 * Chờ đợi nội dung của một trang Single-Page Application (SPA) có khả năng được render xong.
 * Hàm này sử dụng Promise.race để chờ đợi selector phổ biến đầu tiên xuất hiện,
 * giúp nó hoạt động hiệu quả trên cả trang SPA và trang truyền thống.
 *
 * @param page - Đối tượng Page của Playwright.
 * @param logger - Logger để ghi lại các sự kiện.
 */
async function waitForContentToRender(page: Page, logger: Logger): Promise<void> {
    const logContext = { function: 'waitForContentToRender' };

    // Danh sách các "nghi can" phổ biến nhất cho các SPA
    const commonSpaSelectors = [
        '#app',         // Vue.js
        '#root',        // React.js
        'app-root',     // Angular
        'main',         // Thẻ HTML5 ngữ nghĩa
        '#content',
        '.content',
        '#container',
        '.container',
        '.wrapper'
    ];

    try {
        // Tạo một promise cho mỗi selector
        const promises = commonSpaSelectors.map(selector =>
            page.waitForSelector(selector, { state: 'attached', timeout: 10000 })
        );

        // Promise.race sẽ hoàn thành ngay khi promise ĐẦU TIÊN trong danh sách hoàn thành
        await Promise.race(promises);

        logger.trace({ ...logContext, event: 'spa_content_rendered' }, 'A common SPA selector was found. Content is likely rendered.');

    } catch (error) {
        // Lỗi này chỉ xảy ra nếu SAU 10 GIÂY, KHÔNG CÓ BẤT KỲ selector nào trong danh sách xuất hiện.
        // Đây là trường hợp hiếm, nhưng chúng ta vẫn ghi log và tiếp tục.
        logger.warn({ ...logContext, event: 'spa_wait_timed_out' }, 'Timed out waiting for any common SPA selector. Proceeding anyway.');
    }
}

/**
 * Hàm tiện ích để truy cập một URL duy nhất bằng Playwright với khả năng xử lý lỗi mạnh mẽ.
 * Gói gọn logic try-catch, xử lý chuyển hướng, và trả về một đối tượng kết quả có cấu trúc.
 * Được tối ưu để xử lý cả trang HTML tiêu chuẩn và các trang Single-Page Application (SPA) hiện đại.
 *
 * @param page - Đối tượng Page của Playwright.
 * @param url - URL cần truy cập.
 * @param logger - Logger để ghi lại các sự kiện.
 * @returns {Promise<AccessResult>} Một đối tượng chứa kết quả của việc truy cập.
 */
export async function accessUrl(page: Page, url: string, logger: Logger): Promise<AccessResult> {
    const logContext: { initialUrl: string; function: string;[key: string]: any } = {
        initialUrl: url,
        function: 'accessUrl'
    };

    const MAX_RETRIES = 2; // Giảm xuống 2 vì logic đã mạnh hơn
    const RETRY_DELAY_MS = 2000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        logContext['attempt'] = attempt;
        logger.trace({ ...logContext, event: 'access_url_attempt_start' }, `Attempting to access URL: ${url}`);

        try {
            const response = await page.goto(url, {
                waitUntil: 'domcontentloaded', // Chỉ cần chờ HTML được phân tích ban đầu
                timeout: 30000, // Timeout 30 giây cho việc điều hướng
            });

            // Bước 1: Chờ đợi thông minh cho nội dung SPA render
            await waitForContentToRender(page, logger);

            // Bước 2: Chờ đợi linh hoạt cho các tài nguyên phụ tải xong
            try {
                await Promise.race([
                    page.waitForLoadState('networkidle', { timeout: 15000 }),
                    page.waitForLoadState('load', { timeout: 15000 })
                ]);
                logger.trace({ ...logContext, event: 'page_load_state_achieved' });
            } catch (waitError) {
                logger.warn({ ...logContext, err: waitError, event: 'wait_for_load_state_timed_out' }, 'Wait for load/networkidle timed out, proceeding anyway as content is likely present.');
            }

            // +++ GIẢI PHÁP CUỐI CÙNG: CHO JS "THỜI GIAN THỞ" +++
            // Thêm một khoảng chờ ngắn, cố định để đảm bảo các script render cuối cùng có thời gian chạy.
            // Đây là "lưới an toàn" cho các trang SPA cứng đầu.
            logger.trace({ ...logContext, event: 'final_wait_for_spa_render' }, 'Adding a final short wait for SPA rendering.');
            await page.waitForTimeout(3000); // Chờ 3 giây
            // +++ KẾT THÚC THAY ĐỔI +++



            const finalUrl = page.url();

            // Kiểm tra lại response sau tất cả các lần chờ
            if (response && response.ok()) {
                logger.info({ ...logContext, finalUrl, status: response.status(), event: 'access_url_success' }, `Successfully accessed URL on attempt ${attempt}.`);
                return { success: true, finalUrl, response, error: null };
            }

            // Xử lý trường hợp response không ok (ví dụ: 404, 500)
            const error = new Error(`Final response was not OK. Status: ${response?.status()} for URL: ${finalUrl}`);
            logger.warn({ ...logContext, finalUrl, status: response?.status(), event: 'access_url_not_ok_status' }, error.message);
            return { success: false, finalUrl, response, error };

        } catch (error: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(error);
            const accessError = error instanceof Error ? error : new Error(errorMessage);

            // Chỉ thử lại với các lỗi có khả năng là tạm thời
            const isRetryableError = errorMessage.includes('Navigation is interrupted') ||
                errorMessage.includes('interrupted by another navigation') ||
                errorMessage.includes('net::ERR_TIMED_OUT');

            if (isRetryableError && attempt < MAX_RETRIES) {
                logger.warn({ ...logContext, err: { message: errorMessage }, event: 'retryable_error_occurred' },
                    `Attempt ${attempt} failed with a retryable error. Retrying in ${RETRY_DELAY_MS}ms...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                continue; // Chuyển sang lần thử tiếp theo
            }

            // Nếu là lỗi không thể thử lại (như ERR_NAME_NOT_RESOLVED) hoặc đã hết số lần thử
            logger.error({ ...logContext, finalUrl: page.url(), err: { name: accessError.name, message: accessError.message }, event: 'access_url_unrecoverable_error' },
                `Unrecoverable error on attempt ${attempt} or max retries reached: ${accessError.message}`);
            return { success: false, finalUrl: page.url(), response: null, error: accessError };
        }
    }

    // Dòng này chỉ được chạy nếu vòng lặp kết thúc mà không return
    return { success: false, finalUrl: page.url(), response: null, error: new Error('Exhausted all retries for accessUrl') };
}


// src/utils/promiseUtils.ts

/**
 * Wraps a promise with an overall operation timeout.
 * If the operation promise does not settle (resolve or reject) within the timeout period,
 * this function will reject with a timeout error.
 *
 * @param operationPromise The promise representing the long-running operation.
 * @param timeoutMs The timeout in milliseconds.
 * @param operationName A descriptive name for the operation, used in the error message.
 * @returns A new promise that settles with the result of the original promise or rejects on timeout.
 */
export function withOperationTimeout<T>(
    operationPromise: Promise<T>,
    timeoutMs: number,
    operationName: string = 'Unnamed operation'
): Promise<T> {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(`Operation timed out: "${operationName}" did not complete within ${timeoutMs}ms.`));
        }, timeoutMs);
    });

    return Promise.race([
        operationPromise,
        timeoutPromise
    ]).finally(() => {
        // Important: Clear the timeout handle to prevent it from running
        // if the original promise settles first.
        clearTimeout(timeoutHandle);
    });
}





// --- Helper Function for Conditional Scrolling ---
/**
 * Scrolls the page to the bottom to trigger lazy-loaded content.
 * Includes a total timeout and a max attempts limit to prevent infinite loops.
 * @param page The Playwright Page object.
 * @param logger The logger instance.
 */
export async function autoScroll(page: Page, logger: Logger) {
    logger.trace({ event: 'auto_scroll_start' });
    try {
        // Add an overall timeout for the entire scrolling operation.
        await page.evaluate(async (timeoutMs) => {
            await Promise.race([
                new Promise<void>((resolve) => {
                    let totalHeight = 0;
                    const distance = 100;
                    let scrollAttempts = 0;
                    const maxScrollAttempts = 100; // Limit to 100 scrolls (e.g., 10000px)

                    const timer = setInterval(() => {
                        const scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        scrollAttempts++;

                        if (totalHeight >= scrollHeight || scrollAttempts >= maxScrollAttempts) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100); // Scroll every 100ms
                }),
                // A separate promise that rejects after a timeout
                new Promise<void>((_, reject) =>
                    setTimeout(() => reject(new Error(`Auto-scrolling timed out after ${timeoutMs}ms`)), timeoutMs)
                )
            ]);
        }, 15000); // Set a 15-second timeout for the entire scroll operation

        // Wait a moment for animations to complete after scrolling
        await page.waitForTimeout(2000);
        logger.trace({ event: 'auto_scroll_success' });
    } catch (error) {
        logger.warn({ err: error, event: 'auto_scroll_failed_or_timed_out' }, "Auto-scrolling failed or timed out, content might be incomplete.");
    }
}