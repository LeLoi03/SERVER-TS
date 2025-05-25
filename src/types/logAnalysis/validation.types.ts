/**
 * @fileoverview Định nghĩa các kiểu dữ liệu liên quan đến việc xác thực và chuẩn hóa dữ liệu,
 * bao gồm các thông tin chi tiết về chất lượng dữ liệu và thống kê tổng hợp.
 */

/**
 * @interface DataQualityInsight
 * @description Cung cấp thông tin chi tiết về các vấn đề chất lượng dữ liệu hoặc các phép biến đổi trong quá trình xử lý.
 * Được sử dụng để ghi nhật ký và báo cáo các sai lệch dữ liệu tiềm ẩn.
 */
export interface DataQualityInsight {
    /**
     * @property {string} timestamp - Dấu thời gian ISO khi thông tin chi tiết được tạo.
     */
    timestamp: string;
    /**
     * @property {string} field - Tên của trường bị ảnh hưởng bởi thông tin chi tiết (ví dụ: 'location', 'conferenceDates').
     */
    field: string;
    /**
     * @property {any} [originalValue] - Tùy chọn: Giá trị gốc của trường trước bất kỳ thay đổi hoặc cảnh báo nào.
     */
    originalValue?: any;
    /**
     * @property {any} currentValue - Giá trị hiện tại của trường (ví dụ: sau khi chuẩn hóa hoặc giá trị gây ra cảnh báo).
     */
    currentValue: any;
    /**
     * @property {'ValidationWarning' | 'NormalizationApplied' | 'DataCorrection'} insightType - Loại thông tin chi tiết.
     * - 'ValidationWarning': Dữ liệu không đáp ứng tiêu chí mong đợi, nhưng vẫn được giữ lại hoặc xử lý một cách lỏng lẻo.
     * - 'NormalizationApplied': Dữ liệu đã được chuyển đổi hoặc chuẩn hóa.
     * - 'DataCorrection': Dữ liệu đã được sửa chữa chủ động dựa trên các quy tắc cụ thể.
     */
    insightType: 'ValidationWarning' | 'NormalizationApplied' | 'DataCorrection';
    /**
     * @property {'Low' | 'Medium' | 'High'} [severity] - Tùy chọn: Mức độ nghiêm trọng của thông tin chi tiết, chủ yếu dành cho 'ValidationWarning'.
     */
    severity?: 'Low' | 'Medium' | 'High';
    /**
     * @property {string} message - Mô tả chi tiết của thông tin chi tiết.
     */
    message: string;
    /**
     * @property {object} [details] - Tùy chọn: Các chi tiết bổ sung về thông tin chi tiết.
     * @property {string} [details.actionTaken] - Ví dụ: "KeptAsIs", "NormalizedToDefault", "RemovedCharacters".
     * @property {any} [details.normalizedTo] - Giá trị sau khi chuẩn hóa, nếu `insightType` là 'NormalizationApplied'.
     * @property {string} [details.ruleViolated] - Quy tắc cụ thể đã bị vi phạm, nếu áp dụng (ví dụ: "YEAR_REGEX", "VALID_CONTINENTS").
     */
    details?: {
        actionTaken?: string;
        normalizedTo?: any;
        ruleViolated?: string;
    };
}

/**
 * @interface ValidationStats
 * @description Thống kê tổng hợp về xác thực và chuẩn hóa dữ liệu.
 */
export interface ValidationStats {
    // --- Validation Warnings ---
    /**
     * @property {number} totalValidationWarnings - Tổng số cảnh báo xác thực đã ghi.
     */
    totalValidationWarnings: number;
    /**
     * @property {Record<string, number>} warningsByField - Phân tích các cảnh báo xác thực theo tên trường bị ảnh hưởng.
     */
    warningsByField: { [fieldName: string]: number };
    /**
     * @property {object} warningsBySeverity - Phân tích các cảnh báo xác thực theo mức độ nghiêm trọng.
     * @property {number} warningsBySeverity.Low - Số lượng cảnh báo mức độ thấp.
     * @property {number} warningsBySeverity.Medium - Số lượng cảnh báo mức độ trung bình.
     * @property {number} warningsBySeverity.High - Số lượng cảnh báo mức độ cao.
     */
    warningsBySeverity: {
        Low: number;
        Medium: number;
        High: number;
    };
    /**
     * @property {Record<string, number>} warningsByInsightMessage - Phân tích các cảnh báo xác thực theo thông báo/loại cụ thể của chúng.
     */
    warningsByInsightMessage: { [message: string]: number };

    // --- Normalizations ---
    /**
     * @property {number} totalNormalizationsApplied - Tổng số lần chuẩn hóa dữ liệu đã áp dụng.
     */
    totalNormalizationsApplied: number;
    /**
     * @property {Record<string, number>} normalizationsByField - Phân tích các chuẩn hóa theo tên trường bị ảnh hưởng.
     */
    normalizationsByField: { [fieldName: string]: number };
    /**
     * @property {Record<string, number>} normalizationsByReason - Phân tích các chuẩn hóa theo lý do/thông báo chuẩn hóa.
     */
    normalizationsByReason: { [reasonMessage: string]: number };

    // --- Data Corrections (Optional) ---
    /**
     * @property {number} [totalDataCorrections] - Tùy chọn: Tổng số lần sửa chữa dữ liệu đã áp dụng.
     */
    totalDataCorrections?: number;
    /**
     * @property {Record<string, number>} [correctionsByField] - Tùy chọn: Phân tích các sửa chữa dữ liệu theo tên trường bị ảnh hưởng.
     */
    correctionsByField?: { [fieldName: string]: number };
}