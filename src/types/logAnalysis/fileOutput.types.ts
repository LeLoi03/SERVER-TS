/**
 * @fileoverview Định nghĩa các kiểu dữ liệu cho phân tích các hoạt động xuất tệp (File Output),
 * bao gồm cả tệp JSONL và CSV.
 */

/**
 * @interface FileOutputAnalysis
 * @description Phân tích các hoạt động xuất tệp (JSONL và CSV).
 */
export interface FileOutputAnalysis {
    /**
     * @property {number} jsonlRecordsSuccessfullyWritten - Số lượng bản ghi đã được ghi thành công vào các tệp JSONL.
     */
    jsonlRecordsSuccessfullyWritten: number;
    /**
     * @property {number} jsonlWriteErrors - Số lượng lỗi gặp phải trong quá trình ghi tệp JSONL.
     */
    jsonlWriteErrors: number;
    /**
     * @property {boolean | null} csvFileGenerated - Cho biết liệu một tệp CSV có được tạo thành công hay không (null nếu chưa được thử/hoàn thành).
     */
    csvFileGenerated: boolean | null;
    /**
     * @property {number} csvRecordsAttempted - Số lượng bản ghi đã cố gắng ghi vào CSV.
     */
    csvRecordsAttempted: number;
    /**
     * @property {number} csvRecordsSuccessfullyWritten - Số lượng bản ghi đã được ghi thành công vào CSV.
     */
    csvRecordsSuccessfullyWritten: number;
    /**
     * @property {number} csvWriteErrors - Số lượng lỗi gặp phải trong quá trình ghi tệp CSV.
     */
    csvWriteErrors: number;
    /**
     * @property {number} csvOrphanedSuccessRecords - Số lượng bản ghi CSV thành công bị "mồ côi" (ví dụ: không được liên kết với một lô thành công hoàn chỉnh).
     */
    csvOrphanedSuccessRecords: number;
    /**
     * @property {number} csvPipelineFailures - Số lượng lỗi trong pipeline CSV tổng thể.
     */
    csvPipelineFailures: number;
    /**
     * @property {number} [csvOtherErrors] - Tùy chọn: Các lỗi liên quan đến CSV khác không được phân loại.
     */
    csvOtherErrors?: number;
}