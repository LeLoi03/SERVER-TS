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
    // --- SỬA LỖI TYPESCRIPT TẠI ĐÂY ---
    // Khai báo logContext với một kiểu cho phép các thuộc tính bổ sung.
    // [key: string]: any cho phép bạn thêm bất kỳ thuộc tính chuỗi nào.
    const logContext: { initialUrl: string; function: string;[key: string]: any } = {
        initialUrl: url,
        function: 'accessUrl'
    };
    // --- KẾT THÚC SỬA LỖI ---

    // --- THÊM LOGIC THỬ LẠI ---
    const MAX_RETRIES = 3; // Thử tối đa 3 lần
    const RETRY_DELAY_MS = 2000; // Chờ 2 giây giữa các lần thử

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        logContext['attempt'] = attempt; // Thêm số lần thử vào log
        logger.trace({ ...logContext, event: 'access_url_attempt_start' }, `Attempting to access URL: ${url}`);

        try {
            // Sử dụng lại chiến lược goto mạnh mẽ của bạn
            const response = await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 45000,
            });

            await page.waitForLoadState('networkidle', { timeout: 25000 });

            const finalUrl = page.url();

            if (response && response.ok()) {
                logger.info({ ...logContext, finalUrl, status: response.status(), event: 'access_url_success' }, `Successfully accessed URL on attempt ${attempt}.`);
                return { success: true, finalUrl, response, error: null }; // THÀNH CÔNG -> Thoát khỏi vòng lặp
            }

            // Xử lý trường hợp response không ok
            const error = new Error(`Final response was not OK. Status: ${response?.status()} for URL: ${finalUrl}`);
            logger.warn({ ...logContext, finalUrl, status: response?.status(), event: 'access_url_not_ok_status' }, error.message);
            // Không thử lại với lỗi HTTP, vì nó thường là lỗi cố định (404, 500)
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

    // Dòng này trên lý thuyết sẽ không bao giờ được chạy, nhưng để đảm bảo an toàn
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