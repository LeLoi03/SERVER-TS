/**
 * @fileoverview Định nghĩa các kiểu dữ liệu cho phân tích các hoạt động xử lý theo lô (batch processing).
 */

/**
 * @interface BatchProcessingAnalysis
 * @description Phân tích các hoạt động xử lý theo lô.
 */
export interface BatchProcessingAnalysis {
    /**
     * @property {number} totalBatchesAttempted - Tổng số lô đã được thử xử lý.
     */
    totalBatchesAttempted: number;
    /**
     * @property {number} successfulBatches - Số lượng lô đã hoàn thành thành công.
     */
    successfulBatches: number;
    /**
     * @property {number} failedBatches - Số lượng lô đã thất bại.
     */
    failedBatches: number;
    /**
     * @property {number} apiFailures - Số lượng lỗi liên quan đến các cuộc gọi API trong các lô.
     */
    apiFailures: number;
    /**
     * @property {number} fileSystemFailures - Số lượng lỗi liên quan đến các hoạt động hệ thống tệp trong các lô.
     */
    fileSystemFailures: number;
    /**
     * @property {number} logicRejections - Số lần xử lý bị từ chối do lỗi logic (ví dụ: đầu vào không hợp lệ).
     */
    logicRejections: number;
    /**
     * @property {number | null} aggregatedResultsCount - Tổng số kết quả trên tất cả các lô đã xử lý (null nếu không có kết quả).
     */
    aggregatedResultsCount: number | null;
    /**
     * @property {number} determineApiFailures - Số lượng lỗi trong giai đoạn API 'determineLinks'.
     */
    determineApiFailures: number;
    /**
     * @property {number} extractApiFailures - Số lượng lỗi trong giai đoạn API 'extractInfo'.
     */
    extractApiFailures: number;
    /**
     * @property {number} cfpApiFailures - Số lượng lỗi trong giai đoạn API 'extractCfp'.
     */
    cfpApiFailures: number;
    /**
     * @property {number} apiResponseParseFailures - Số lần phản hồi API không thể phân tích cú pháp.
     */
    apiResponseParseFailures: number;
}