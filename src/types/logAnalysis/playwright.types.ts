/**
 * @fileoverview Định nghĩa các kiểu dữ liệu cho phân tích chi tiết các hoạt động của Playwright (web scraping).
 * Cung cấp cái nhìn sâu sắc về hiệu suất và các vấn đề gặp phải trong quá trình cạo web.
 */

/**
 * @interface PlaywrightAnalysis
 * @description Phân tích toàn diện các hoạt động của Playwright (web scraping).
 */
export interface PlaywrightAnalysis {
    /**
     * @property {number} setupAttempts - Số lần cố gắng thiết lập trình duyệt Playwright.
     */
    setupAttempts: number;
    /**
     * @property {boolean | null} setupSuccess - Cho biết liệu việc thiết lập Playwright có thành công cuối cùng hay không (null nếu chưa được thử/hoàn thành).
     */
    setupSuccess: boolean | null;
    /**
     * @property {boolean | string | null} setupError - Thông báo lỗi hoặc giá trị boolean cho biết việc thiết lập thất bại.
     */
    setupError: boolean | string | null;
    /**
     * @property {number} contextErrors - Số lượng lỗi xảy ra trong ngữ cảnh trình duyệt.
     */
    contextErrors: number;
    /**
     * @property {number} htmlSaveAttempts - Tổng số lần cố gắng lưu nội dung HTML.
     */
    htmlSaveAttempts: number;
    /**
     * @property {number} successfulSaveInitiations - Số lần các hoạt động lưu HTML được bắt đầu thành công.
     */
    successfulSaveInitiations: number;
    /**
     * @property {number} failedSaves - Số lượng hoạt động lưu HTML đã thất bại.
     */
    failedSaves: number;
    /**
     * @property {number} skippedSaves - Số lượng hoạt động lưu HTML đã bị bỏ qua.
     */
    skippedSaves: number;
    /**
     * @property {object} linkProcessing - Phân tích chi tiết thống kê xử lý liên kết.
     * @property {number} linkProcessing.totalLinksAttempted - Tổng số liên kết đã cố gắng truy cập và xử lý.
     * @property {number} linkProcessing.successfulAccess - Số lượng liên kết đã truy cập thành công.
     * @property {number} linkProcessing.failedAccess - Số lượng liên kết không truy cập được.
     * @property {number} linkProcessing.redirects - Số lượng lần chuyển hướng gặp phải trong quá trình truy cập liên kết.
     */
    linkProcessing: {
        totalLinksAttempted: number;
        successfulAccess: number;
        failedAccess: number;
        redirects: number;
    };
    /**
     * @property {number} otherFailures - Số lượng các lỗi Playwright khác không được phân loại.
     */
    otherFailures: number;
    /**
     * @property {Record<string, number>} errorsByType - Một bản đồ các loại lỗi với số lượng của chúng, trong đó các khóa là các chuỗi lỗi đã được chuẩn hóa.
     */
    errorsByType: { [normalizedErrorKey: string]: number };
}