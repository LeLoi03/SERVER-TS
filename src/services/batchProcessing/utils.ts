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
        // Sử dụng 'domcontentloaded' để nhận phản hồi nhanh hơn, sau đó tự chờ đợi.
        // 'domcontentloaded' ít bị ảnh hưởng bởi các lỗi 'interrupted' do script hoặc tài nguyên phụ gây ra.
        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded', // THAY ĐỔI 1: Chờ đến khi DOM chính được tải.
            timeout: 45000,             // THAY ĐỔI 2: Tăng timeout tổng thể.
        });

        // Sau khi DOM đã tải, chúng ta chủ động chờ cho mạng lưới ổn định.
        // Điều này tách biệt việc điều hướng ban đầu khỏi việc chờ tài nguyên phụ,
        // làm cho nó mạnh mẽ hơn trước các lỗi 'interrupted'.
        try {
            await page.waitForLoadState('networkidle', { timeout: 25000 });
            logger.trace({ ...logContext, event: 'networkidle_wait_completed' });
        } catch (waitError) {
            logger.warn({ ...logContext, err: waitError, event: 'networkidle_wait_timed_out_but_proceeding' },
                'Timed out waiting for networkidle, but proceeding as the main content might be loaded.');
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

        // --- THAY ĐỔI LOGIC TẠI ĐÂY ---
        if (errorMessage.includes('Navigation is interrupted') || errorMessage.includes('interrupted by another navigation')) {
            // KIỂM TRA THÊM: URL cuối cùng có phải là một trang web hợp lệ không?
            if (/^https?:\/\//.test(finalUrlAfterError)) {
                logger.warn({ ...logContext, finalUrl: finalUrlAfterError, originalError: errorMessage, event: 'navigation_interrupted_handled_as_success' },
                    `Navigation was interrupted but resulted in a valid web URL. Handling as success. Final URL: ${finalUrlAfterError}`);
                // Chỉ coi là thành công nếu URL cuối cùng là một trang web thực sự
                return { success: true, finalUrl: finalUrlAfterError, response: null, error: null };
            } else {
                // Nếu URL cuối cùng là trang lỗi (chrome-error://, about:blank, etc.), coi đây là một lỗi thực sự
                logger.error({ ...logContext, finalUrl: finalUrlAfterError, err: { name: accessError.name, message: accessError.message }, event: 'navigation_interrupted_to_error_page' },
                    `Navigation was interrupted and led to an invalid/error page. Handling as failure. Final URL: ${finalUrlAfterError}`);
                return { success: false, finalUrl: finalUrlAfterError, response: null, error: accessError };
            }
        }
        // --- KẾT THÚC THAY ĐỔI ---

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