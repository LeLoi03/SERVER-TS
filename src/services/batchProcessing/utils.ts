// /src/utils/playwright.utils.ts
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
        // Sử dụng 'domcontentloaded' để goto nhanh hơn, vì nó chỉ chờ cây DOM được xây dựng.
        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 45000, // Timeout cho việc điều hướng ban đầu
        });

        // === THAY ĐỔI CỐT LÕI NẰM Ở ĐÂY ===
        try {
            // Cố gắng chờ đến khi mạng yên tĩnh, nhưng không coi timeout là lỗi nghiêm trọng.
            // 'networkidle' thường tốt hơn 'load' cho các trang hiện đại.
            await page.waitForLoadState('networkidle', { timeout: 20000 });
            logger.trace({ ...logContext, event: 'wait_for_networkidle_success' }, "Network reached 'networkidle' state successfully.");
        } catch (waitTimeoutError: unknown) {
            // Nếu bị timeout, ghi một cảnh báo và tiếp tục.
            const { message: errorMessage } = getErrorMessageAndStack(waitTimeoutError);
            logger.warn({ ...logContext, originalError: errorMessage, event: 'wait_for_networkidle_timed_out_but_proceeding' },
                `Timed out waiting for 'networkidle' state, but proceeding anyway. Error: "${errorMessage}"`);
            // KHÔNG ném lỗi ra ngoài, chúng ta chấp nhận trạng thái hiện tại của trang.
        }
        // === KẾT THÚC THAY ĐỔI ===

        const finalUrl = page.url();

        // Kiểm tra response cuối cùng (có thể là null nếu có lỗi nghiêm trọng)
        if (!response) {
            const error = new Error(`Navigation to ${url} resulted in a null response.`);
            logger.error({ ...logContext, finalUrl, event: 'access_url_null_response' }, error.message);
            return { success: false, finalUrl, response, error };
        }

        if (!response.ok()) {
            const error = new Error(`Final response was not OK. Status: ${response.status()} for URL: ${finalUrl}`);
            logger.warn({ ...logContext, finalUrl, status: response.status(), event: 'access_url_not_ok_status' }, error.message);
            // Coi các lỗi client/server (4xx, 5xx) là thất bại.
            return { success: false, finalUrl, response, error };
        }

        logger.info({ ...logContext, finalUrl, status: response.status(), event: 'access_url_success' }, `Successfully accessed URL. Final URL: ${finalUrl}`);
        // Coi như thành công vì chúng ta đã có response.ok() và đã cố gắng chờ.
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

        // Các lỗi khác (ví dụ: ERR_NAME_NOT_RESOLVED) vẫn là lỗi nghiêm trọng.
        logger.error({ ...logContext, finalUrl: finalUrlAfterError, err: { name: accessError.name, message: accessError.message }, event: 'access_url_unhandled_error' }, `Unhandled error during URL access: ${accessError.message}`);
        return { success: false, finalUrl: finalUrlAfterError, response: null, error: accessError };
    }
}