// /src/utils/playwright.utils.ts (hoặc một file tương tự)
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
 * Hàm tiện ích để truy cập một URL duy nhất bằng Playwright.
 * Gói gọn logic try-catch và trả về một đối tượng kết quả có cấu trúc.
 *
 * @param page - Đối tượng Page của Playwright.
 * @param url - URL cần truy cập.
 * @param logger - Logger để ghi lại các sự kiện.
 * @returns {Promise<AccessResult>} Một đối tượng chứa kết quả của việc truy cập.
 */
export async function accessUrl(page: Page, url: string, logger: Logger): Promise<AccessResult> {
    try {
        // Sử dụng 'load' để tăng độ tin cậy và tốc độ, ít bị lỗi ERR_ABORTED hơn
        // Tăng timeout lên 30 giây để xử lý các trang phản hồi chậm
        const response = await page.goto(url, { waitUntil: "load", timeout: 30000 });
        
        // Sau khi goto thành công, chờ một selector cơ bản để đảm bảo trang đã render phần nào
        await page.waitForSelector('body', { state: 'attached', timeout: 10000 });
        
        const finalUrl = page.url();
        return { success: true, finalUrl, response, error: null };
    } catch (error: unknown) {
        const { message: errorMessage } = getErrorMessageAndStack(error);
        const accessError = error instanceof Error ? error : new Error(errorMessage);
        return { success: false, finalUrl: null, response: null, error: accessError };
    }
}