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
    const logContext = { initialUrl: url, function: 'accessUrl' };
    logger.trace({ ...logContext, event: 'access_url_start' }, `Attempting to access URL: ${url}`);

    try {
        // Bước 1: Điều hướng nhanh chóng.
        // 'commit' là lựa chọn tốt cho các trang SPA, nó trả về ngay khi điều hướng được máy chủ xác nhận,
        // không cần chờ toàn bộ tài nguyên.
        const response = await page.goto(url, {
            waitUntil: 'commit',
            timeout: 45000,
        });

        // Bước 2: Chờ đợi thông minh sau khi điều hướng.
        // Điều này rất quan trọng để cho các framework JavaScript (React, Vue, Next.js)
        // có thời gian để fetch dữ liệu và render nội dung lên trang.
        try {
            // Chúng ta chờ một trong hai điều kiện xảy ra trước:
            // 1. Mạng trở nên yên tĩnh ('networkidle'). Đây là trạng thái lý tưởng.
            // 2. Một khoảng thời gian chờ ngắn (ví dụ: 2 giây) trôi qua. Đây là phương án dự phòng
            //    để đảm bảo chúng ta không bị kẹt nếu trang có các script chạy nền vô tận.
            await Promise.race([
                page.waitForLoadState('networkidle', { timeout: 20000 }),
                page.waitForTimeout(2000)
            ]);
            logger.trace({ ...logContext, event: 'intelligent_wait_completed' }, "Intelligent wait after navigation completed.");
        } catch (waitError: unknown) {
            // Lỗi ở đây (thường là timeout từ networkidle) không phải là lỗi nghiêm trọng.
            // Chúng ta ghi lại cảnh báo và tiếp tục, vì nội dung chính có thể đã được tải.
            const { message: errorMessage } = getErrorMessageAndStack(waitError);
            logger.warn({ ...logContext, originalError: errorMessage, event: 'wait_for_networkidle_timed_out_but_proceeding' },
                `Timed out waiting for 'networkidle' state, but proceeding anyway. Error: "${errorMessage}"`);
        }

        const finalUrl = page.url();

        if (!response) {
            const error = new Error(`Navigation to ${url} resulted in a null response.`);
            logger.error({ ...logContext, finalUrl, event: 'access_url_null_response' }, error.message);
            return { success: false, finalUrl, response, error };
        }

        if (!response.ok()) {
            const error = new Error(`Final response was not OK. Status: ${response.status()} for URL: ${finalUrl}`);
            logger.warn({ ...logContext, finalUrl, status: response.status(), event: 'access_url_not_ok_status' }, error.message);
            return { success: false, finalUrl, response, error };
        }

        logger.info({ ...logContext, finalUrl, status: response.status(), event: 'access_url_success' }, `Successfully accessed URL. Final URL: ${finalUrl}`);
        return { success: true, finalUrl, response, error: null };

    } catch (error: unknown) {
        const { message: errorMessage } = getErrorMessageAndStack(error);
        const accessError = error instanceof Error ? error : new Error(errorMessage);
        const finalUrlAfterError = page.url();

        // Xử lý lỗi 'Navigation is interrupted' vẫn như cũ
        if (errorMessage.includes('Navigation is interrupted') || errorMessage.includes('interrupted by another navigation')) {
            logger.warn({ ...logContext, finalUrl: finalUrlAfterError, originalError: errorMessage, event: 'navigation_interrupted_handled_as_success' },
                `Navigation was interrupted but handled as a successful redirect. Final URL: ${finalUrlAfterError}`);
            return { success: true, finalUrl: finalUrlAfterError, response: null, error: null };
        }

        // Các lỗi khác (ví dụ: ERR_NAME_NOT_RESOLVED, ERR_CONNECTION_REFUSED) vẫn là lỗi nghiêm trọng.
        logger.error({ ...logContext, finalUrl: finalUrlAfterError, err: { name: accessError.name, message: accessError.message }, event: 'access_url_unhandled_error' }, `Unhandled error during URL access: ${accessError.message}`);
        return { success: false, finalUrl: finalUrlAfterError, response: null, error: accessError };
    }
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