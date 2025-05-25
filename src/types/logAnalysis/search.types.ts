/**
 * @fileoverview Định nghĩa các kiểu dữ liệu liên quan đến việc phân tích các hoạt động tìm kiếm Google,
 * bao gồm các chỉ số về tình trạng khóa API và phân tích chi tiết các truy vấn tìm kiếm.
 */

/**
 * @interface GoogleSearchHealthData
 * @description Định nghĩa các chỉ số sức khỏe cấp cao liên quan đến việc xoay vòng và sử dụng khóa API Google Custom Search.
 */
export interface GoogleSearchHealthData {
    /**
     * @property {number} rotationsSuccess - Số lần xoay vòng khóa API thành công.
     */
    rotationsSuccess: number;
    /**
     * @property {number} rotationsFailed - Số lần xoay vòng khóa API thất bại.
     */
    rotationsFailed: number;
    /**
     * @property {number} allKeysExhaustedOnGetNextKey - Tổng số lần tất cả các khóa API đã cấu hình bị cạn kiệt khi cố gắng lấy khóa tiếp theo.
     */
    allKeysExhaustedOnGetNextKey: number;
    /**
     * @property {number} maxUsageLimitsReachedTotal - Tổng số lần giới hạn sử dụng tối đa (trên tất cả các khóa) được báo cáo là đã đạt đến.
     */
    maxUsageLimitsReachedTotal: number;
    /**
     * @property {number} successfulSearchesWithNoItems - Số lượng truy vấn tìm kiếm thành công nhưng không trả về bất kỳ mục nào (tức là kết quả trống).
     */
    successfulSearchesWithNoItems: number;
}

/**
 * @interface GoogleSearchAnalysis
 * @description Phân tích toàn diện các hoạt động tìm kiếm Google.
 */
export interface GoogleSearchAnalysis {
    /**
     * @property {number} totalRequests - Tổng số yêu cầu API Google Search đã thực hiện.
     */
    totalRequests: number;
    /**
     * @property {number} successfulSearches - Số lượng truy vấn tìm kiếm thành công.
     */
    successfulSearches: number;
    /**
     * @property {number} failedSearches - Số lượng truy vấn tìm kiếm thất bại.
     */
    failedSearches: number;
    /**
     * @property {number} skippedSearches - Số lượng truy vấn tìm kiếm đã bị bỏ qua.
     */
    skippedSearches: number;
    /**
     * @property {number} quotaErrors - Số lần gặp lỗi quota chung (có thể trùng lặp với `keySpecificLimitsReached`).
     */
    quotaErrors: number;
    /**
     * @property {Record<string, number>} keyUsage - Phân tích việc sử dụng khóa API theo từng khóa.
     */
    keyUsage: { [apiKey: string]: number };
    /**
     * @property {Record<string, number>} errorsByType - Một bản đồ các loại lỗi với số lượng của chúng, trong đó các khóa là các chuỗi lỗi đã được chuẩn hóa.
     */
    errorsByType: { [normalizedErrorKey: string]: number };
    /**
     * @property {number} attemptIssues - Số lượng vấn đề gặp phải trong quá trình thử tìm kiếm (ví dụ: URL không đúng định dạng).
     */
    attemptIssues: number;
    /**
     * @property {Record<string, number>} attemptIssueDetails - Phân tích chi tiết các vấn đề cụ thể trong quá trình thử.
     */
    attemptIssueDetails: Record<string, number>;
    /**
     * @property {number} apiKeyLimitsReached - Số lần giới hạn khóa API Google được đạt đến một cách rõ ràng.
     */
    apiKeyLimitsReached: number;
    /**
     * @property {Record<string, number>} keySpecificLimitsReached - Phân tích giới hạn đã đạt đến cho các khóa API cụ thể.
     */
    keySpecificLimitsReached: Record<string, number>;
    /**
     * @property {number} apiKeysProvidedCount - Tổng số khóa API được cung cấp cho Google Search.
     */
    apiKeysProvidedCount: number;
    /**
     * @property {number} allKeysExhaustedEvents_GetNextKey - Số lần tất cả các khóa bị cạn kiệt khi lấy khóa tiếp theo.
     */
    allKeysExhaustedEvents_GetNextKey: number;
    /**
     * @property {number} allKeysExhaustedEvents_StatusCheck - Số lần tất cả các khóa bị cạn kiệt trong quá trình kiểm tra trạng thái.
     */
    allKeysExhaustedEvents_StatusCheck: number;
    /**
     * @property {number} apiKeyRotationsSuccess - Số lần xoay vòng khóa API thành công.
     */
    apiKeyRotationsSuccess: number;
    /**
     * @property {number} apiKeyRotationsFailed - Số lần xoay vòng khóa API thất bại.
     */
    apiKeyRotationsFailed: number;
    /**
     * @property {number} successfulSearchesWithNoItems - Số lượng tìm kiếm thành công nhưng không trả về mục nào.
     */
    successfulSearchesWithNoItems: number;
    /**
     * @property {number} malformedResultItems - Số lần nhận được các mục kết quả không đúng định dạng từ Google CSE.
     */
    malformedResultItems: number;
}