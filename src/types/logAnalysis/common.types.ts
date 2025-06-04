/**
 * @fileoverview Định nghĩa các kiểu dữ liệu và interface chung được sử dụng trên toàn bộ ứng dụng,
 * đặc biệt là cho việc ghi nhật ký, theo dõi thời gian và quản lý lỗi.
 */

/**
 * @interface RequestTimings
 * @description Cung cấp thông tin về thời gian và trạng thái cho một yêu cầu lô cụ thể hoặc chi tiết hội nghị.
 */
export interface RequestTimings {
    /**
     * @property {string | null} startTime - Thời gian bắt đầu của yêu cầu ở định dạng chuỗi ISO, hoặc null nếu không khả dụng.
     */
    startTime: string | null;
    /**
     * @property {string | null} endTime - Thời gian kết thúc của yêu cầu ở định dạng chuỗi ISO, hoặc null nếu không khả dụng.
     */
    endTime: string | null;
    /**
     * @property {number | null} durationSeconds - Thời lượng của yêu cầu tính bằng giây, hoặc null nếu thời gian không khả dụng.
     */
    durationSeconds: number | null;
    /**
     * @property {'Completed' | 'Failed' | 'Processing' | 'CompletedWithErrors' | 'PartiallyCompleted' | 'Skipped' | 'NoData' | 'Unknown'} [status] - Trạng thái tổng thể của quá trình xử lý yêu cầu.
     * ...
     */
    status?:
    | 'Completed'
    | 'Failed'
    | 'Processing'
    | 'CompletedWithErrors'
    | 'PartiallyCompleted'
    | 'Skipped'
    | 'NoData'
    | 'Unknown'
    | 'NoRequestsAnalyzed'      // THÊM VÀO
    | 'NotFoundInAggregation';  // THÊM VÀO
    /**
     * @property {string} [originalRequestId] - Tùy chọn: ID gốc được cung cấp cho yêu cầu, nếu đó là một lần thu thập lại.
     */
    originalRequestId?: string;

    // THÊM CÁC THUỘC TÍNH MỚI NÀY VÀO RequestTimings
    /** NEW: Tổng số hội nghị đầu vào ban đầu cho yêu cầu cụ thể này. */
    totalConferencesInputForRequest?: number;
    /** NEW: Số lượng hội nghị đã được xử lý hoàn tất cho yêu cầu cụ thể này. */
    processedConferencesCountForRequest?: number;
    csvOutputStreamFailed?: boolean;
    /**
        * @property {string[]} [errorMessages] - Mảng các thông báo lỗi tóm tắt cho yêu cầu này.
        * Được điền nếu request `status` là `Failed` hoặc `CompletedWithErrors`.
        */
    errorMessages: string[]; // <<< THÊM TRƯỜNG MỚI NÀY >>>
}




// Định nghĩa LogEntry ở đây
/**
 * @interface LogEntry
 * @description Đại diện cho một dòng log đã được parse từ file log.
 * Đây là một cấu trúc chung; các log entry cụ thể có thể có nhiều trường hơn.
 */
export interface LogEntry {
    /**
     * @property {string | number} time - Timestamp của log entry (chuỗi ISO hoặc Unix ms).
     * Pino thường output dạng Unix ms, nhưng khi parse từ JSON có thể là string nếu stdTimeFunctions.isoTime được dùng.
     */
    time: string | number;
    /**
     * @property {number} level - Cấp độ log của Pino (ví dụ: 10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal).
     */
    level: number;
    /**
     * @property {string} [msg] - Thông điệp chính của log entry.
     * Pino thường sử dụng 'msg'.
     */
    msg?: string;
    /**
     * @property {string} [message] - Trường thay thế cho thông điệp chính (để tương thích).
     */
    message?: string;
    /**
     * @property {string} [batchRequestId] - ID của batch request mà log entry này thuộc về.
     * Trường này sẽ được tự động thêm bởi request-specific logger.
     */
    batchRequestId?: string;
    /**
     * @property {string} [service] - Tên service hoặc module đã tạo ra log.
     */
    service?: string;
    /**
     * @property {string} [event] - Tên một sự kiện cụ thể liên quan đến log.
     */
    event?: string;
    /**
     * @property {string} [conferenceAcronym] - Từ viết tắt của hội nghị (nếu có).
     */
    conferenceAcronym?: string;
    /**
     * @property {string} [conferenceTitle] - Tiêu đề của hội nghị (nếu có).
     */
    conferenceTitle?: string;
    /**
     * @property {string} [url] - URL liên quan đến log entry (nếu có).
     */
    url?: string;
    /**
     * @property {any} [err] - Đối tượng lỗi (nếu log entry này là một lỗi).
     * Pino thường đặt lỗi vào trường 'err'.
     */
    err?: any;
    /**
     * @property {number} [durationMs] - Thời gian thực thi một tác vụ (tính bằng mili giây).
     */
    durationMs?: number;
    // Cho phép các thuộc tính khác không được định nghĩa tường minh
    [key: string]: any;
}




/**
 * @interface RequestLogData
 * @description Tổng hợp tất cả các mục nhật ký liên quan cho một ID yêu cầu lô nhất định.
 */
export interface RequestLogData {
    /**
     * @property {LogEntry[]} logs - Một mảng các mục nhật ký đã được parse, liên kết với yêu cầu này.
     */
    logs: LogEntry[]; // <-- THAY ĐỔI TỪ any[] thành LogEntry[]
    /**
     * @property {number | null} startTime - Dấu thời gian Unix sớm nhất (mili giây) được tìm thấy cho yêu cầu này.
     */
    startTime: number | null;
    /**
     * @property {number | null} endTime - Dấu thời gian Unix mới nhất (mili giây) được tìm thấy cho yêu cầu này.
     */
    endTime: number | null;
}

/**
 * @interface ReadLogResult
 * @description Đại diện cho kết quả tổng thể của việc đọc và phân tích cú pháp ban đầu các tệp nhật ký.
 */
export interface ReadLogResult {
    /**
     * @property {Map<string, RequestLogData>} requestsData - Một Map trong đó các khóa là `batchRequestId` và giá trị là các đối tượng `RequestLogData`.
     */
    requestsData: Map<string, RequestLogData>;
    /**
     * @property {number} totalEntries - Tổng số mục nhật ký được đọc từ (các) tệp.
     */
    totalEntries: number;
    /**
     * @property {number} parsedEntries - Số lượng mục nhật ký đã được phân tích cú pháp thành công.
     */
    parsedEntries: number;
    /**
     * @property {number} parseErrors - Số lượng lỗi gặp phải trong quá trình phân tích cú pháp nhật ký.
     */
    parseErrors: number;
    /**
     * @property {string[]} logProcessingErrors - Một mảng các thông báo lỗi gặp phải trong quá trình xử lý nhật ký (ví dụ: lỗi đọc tệp).
     */
    logProcessingErrors: string[];
}

/**
 * @interface FilteredData
 * @description Đại diện cho dữ liệu đã được lọc dựa trên phạm vi thời gian hoặc ID yêu cầu.
 */
export interface FilteredData {
    /**
     * @property {Map<string, RequestLogData>} filteredRequests - Một Map các yêu cầu đã vượt qua tiêu chí lọc.
     */
    filteredRequests: Map<string, RequestLogData>;
    /**
     * @property {number | null} analysisStartMillis - Dấu thời gian bắt đầu (mili giây) của giai đoạn phân tích, dựa trên các bộ lọc đã áp dụng.
     */
    analysisStartMillis: number | null;
    /**
     * @property {number | null} analysisEndMillis - Dấu thời gian kết thúc (mili giây) của giai đoạn phân tích, dựa trên các bộ lọc đã áp dụng.
     */
    analysisEndMillis: number | null;
}

/**
 * @interface LogErrorContext
 * @description Cung cấp ngữ cảnh chi tiết hơn về nguồn gốc của một lỗi nhật ký.
 */
export interface LogErrorContext {
    /**
     * @property {'primary_execution' | 'fallback_execution' | 'setup' | 'response_processing' | 'sdk_call' | string} [phase] - Giai đoạn của quá trình xử lý mà lỗi xảy ra.
     */
    phase?: 'primary_execution' | 'fallback_execution' | 'setup' | 'response_processing' | 'sdk_call' | 'response_processing' | string;
    /**
     * @property {string} [modelIdentifier] - Định danh của mô hình được sử dụng khi lỗi xảy ra.
     */
    modelIdentifier?: string;
    /**
     * @property {string} [apiType] - Loại API được gọi khi lỗi xảy ra.
     */
    apiType?: string;
    /**
     * @property {any} [key: string] - Cho phép thêm bất kỳ thuộc tính ngữ cảnh nào khác.
     */
    [key: string]: any;
}

/**
 * @interface LogError
 * @description Đại diện cho một cấu trúc lỗi chung để ghi nhật ký.
 */
export interface LogError {
    /**
     * @property {string} timestamp - Dấu thời gian ISO khi lỗi xảy ra.
     */
    timestamp: string;
    /**
     * @property {string} message - Thông báo lỗi.
     */
    message: string;
    /**
     * @property {string} key - Khóa đã chuẩn hóa cho lỗi này (ví dụ: để tổng hợp).
     */
    key: string;
    /**
     * @property {any} [details] - Tùy chọn: Chi tiết bổ sung về lỗi.
     */
    details?: any;
    /**
     * @property {string} [errorCode] - Tùy chọn: Mã lỗi cụ thể.
     */
    errorCode?: string;
    /**
     * @property {string} [sourceService] - Tùy chọn: Dịch vụ hoặc thành phần nguồn gây ra lỗi.
     */
    sourceService?: string;
    /**
     * @property {'DataParsing' | 'Network' | 'APIQuota' | 'Logic' | 'FileSystem' | 'SafetyBlock' | 'Configuration' | 'Unknown' | 'ThirdPartyAPI'} [errorType] - Tùy chọn: Loại lỗi được phân loại.
     */
    errorType?: 'DataParsing' | 'Network' | 'APIQuota' | 'Logic' | 'FileSystem' | 'SafetyBlock' | 'Configuration' | 'Unknown' | 'ThirdPartyAPI';
    /**
     * @property {boolean} [isRecovered] - Tùy chọn: True nếu lỗi này đã được khắc phục bởi một hành động sau đó (ví dụ: fallback).
     */
    isRecovered?: boolean;
    /**
     * @property {LogErrorContext} [context] - Tùy chọn: Ngữ cảnh chi tiết hơn về nguồn gốc lỗi.
     */
    context?: LogErrorContext;
}