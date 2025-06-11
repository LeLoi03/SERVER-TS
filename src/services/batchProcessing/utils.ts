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
        // Sử dụng 'load' hoặc 'domcontentloaded' để cân bằng giữa tốc độ và sự hoàn chỉnh.
        // 'load' chờ cả các tài nguyên phụ như ảnh, trong khi 'domcontentloaded' nhanh hơn.
        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 45000,
        });

        // Sau khi goto, Playwright đã tự động theo các redirect.
        // Chờ thêm một chút để các script cuối cùng có thể chạy.
        await page.waitForLoadState('load', { timeout: 20000 });

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
        return { success: true, finalUrl, response, error: null };

    } catch (error: unknown) {
        const { message: errorMessage } = getErrorMessageAndStack(error);
        const accessError = error instanceof Error ? error : new Error(errorMessage);
        const finalUrlAfterError = page.url();

        // === XỬ LÝ LỖI ĐẶC BIỆT: NAVIGATION INTERRUPTED ===
        // Lỗi này thường có nghĩa là một redirect đã xảy ra và Playwright đã theo nó.
        // Chúng ta sẽ coi đây là một trường hợp "thành công có điều kiện" và để cho các bước sau xác thực.
        if (errorMessage.includes('Navigation is interrupted') || errorMessage.includes('interrupted by another navigation')) {
            logger.warn({ ...logContext, finalUrl: finalUrlAfterError, originalError: errorMessage, event: 'navigation_interrupted_handled_as_success' },
                `Navigation was interrupted but handled as a successful redirect. Final URL: ${finalUrlAfterError}`);
            
            // Vì chúng ta không có đối tượng `response` đáng tin cậy ở đây,
            // chúng ta trả về `success: true` nhưng `response: null`.
            // Hàm gọi sẽ cần kiểm tra `response.ok()` nếu nó muốn chắc chắn.
            // Trong kiến trúc hiện tại, việc trích xuất nội dung ở bước sau sẽ là phép thử cuối cùng.
            return { success: true, finalUrl: finalUrlAfterError, response: null, error: null };
        }

        // Các lỗi khác (ví dụ: ERR_NAME_NOT_RESOLVED, ERR_CONNECTION_REFUSED, timeout)
        logger.error({ ...logContext, finalUrl: finalUrlAfterError, err: { name: accessError.name, message: accessError.message }, event: 'access_url_unhandled_error' }, `Unhandled error during URL access: ${accessError.message}`);
        return { success: false, finalUrl: finalUrlAfterError, response: null, error: accessError };
    }
}