/**
 * @fileoverview Định nghĩa các kiểu dữ liệu liên quan đến luồng thu thập dữ liệu (crawl flow),
 * bao gồm các loại mô hình AI, cấu trúc dữ liệu đầu vào và trung gian,
 * định dạng đầu ra tệp JSONL, dữ liệu đã xử lý, và các kiểu liên quan đến Google Search API.
 */

// --------------------- GLOBAL CRAWL FLOW TYPES ---------------------

/**
 * @description Định nghĩa loại mô hình AI Gemini sẽ được sử dụng cho các cuộc gọi API khác nhau trong quá trình thu thập dữ liệu.
 * - `'non-tuned'`: Đề cập đến mô hình Gemini cơ sở, nền tảng (ví dụ: `gemini-pro`).
 * - `'tuned'`: Đề cập đến phiên bản mô hình Gemini đã được tinh chỉnh, tối ưu hóa cho các tác vụ cụ thể.
 */
export type CrawlModelType = 'non-tuned' | 'tuned';

/**
 * @interface ApiModels
 * @description Chỉ định tùy chọn mô hình AI cho mỗi giai đoạn của pipeline thu thập dữ liệu.
 * Điều này cho phép lựa chọn động giữa các mô hình 'tuned' và 'non-tuned'.
 */
export interface ApiModels {
    /**
     * @property {CrawlModelType} determineLinks - Loại mô hình sẽ được sử dụng cho giai đoạn API 'determineLinks'.
     */
    determineLinks: CrawlModelType;
    /**
     * @property {CrawlModelType} extractInfo - Loại mô hình sẽ được sử dụng cho giai đoạn API 'extractInfo'.
     */
    extractInfo: CrawlModelType;
    /**
     * @property {CrawlModelType} extractCfp - Loại mô hình sẽ được sử dụng cho giai đoạn API 'extractCfp'.
     */
    extractCfp: CrawlModelType;
}

// --------------------- INITIAL INPUT DATA TYPES ---------------------

/**
 * @interface ConferenceData
 * @description Đại diện cho dữ liệu đầu vào ban đầu cho một hội nghị, thường từ tệp CSV
 * hoặc được cung cấp thông qua yêu cầu API để thu thập dữ liệu.
 */
export interface ConferenceData {
    /**
     * @property {string} Title - Tiêu đề đầy đủ của hội nghị.
     */
    Title: string;
    /**
     * @property {string} Acronym - Từ viết tắt hoặc tên viết tắt của hội nghị.
     */
    Acronym: string;
    /**
     * @property {string | number} [id] - Tùy chọn: Một định danh duy nhất cho hội nghị từ nguồn của nó (ví dụ: ID hàng CSV, ID cơ sở dữ liệu).
     */
    id?: string | number;
    /**
     * @property {string} [originalRequestId] - Tùy chọn: ID của yêu cầu gốc nếu đây là một lần thu thập lại hoặc một phần của lô lớn hơn.
     */
    originalRequestId?: string;
    /**
     * @property {string} [mainLink] - Tùy chọn: Liên kết chính (URL) của hội nghị.
     */
    mainLink?: string;
    /**
     * @property {string} [cfpLink] - Tùy chọn: URL cho Call for Papers (CFP).
     */
    cfpLink?: string;
    /**
     * @property {string} [impLink] - Tùy chọn: URL cho các ngày quan trọng.
     */
    impLink?: string;
}

/**
 * @interface ConferenceUpdateData
 * @description Đại diện cho dữ liệu đầu vào dành riêng cho luồng thu thập dữ liệu CẬP NHẬT,
 * trong đó các liên kết chính, CFP và ngày quan trọng đã được biết.
 */
export interface ConferenceUpdateData {
    /**
     * @property {string} Title - Tiêu đề đầy đủ của hội nghị.
     */
    Title: string;
    /**
     * @property {string} Acronym - Từ viết tắt hoặc tên viết tắt của hội nghị.
     */
    Acronym: string;
    /**
     * @property {any} mainLink - URL chính của hội nghị. (Sử dụng `any` nếu kiểu cụ thể chưa xác định, nên làm rõ `string` nếu luôn là URL)
     */
    mainLink: any;
    /**
     * @property {any} cfpLink - URL cho Call for Papers (CFP). (Sử dụng `any` nếu kiểu cụ thể chưa xác định, nên làm rõ `string` nếu luôn là URL)
     */
    cfpLink: any;
    /**
     * @property {any} impLink - URL cho các ngày quan trọng. (Sử dụng `any` nếu kiểu cụ thể chưa xác định, nên làm rõ `string` nếu luôn là URL)
     */
    impLink: any;
    /**
     * @property {string} [originalRequestId] - Tùy chọn: ID của yêu cầu gốc nếu đây là một lần thu thập lại.
     */
    originalRequestId?: string;
}

// --------------------- INTERMEDIATE BATCH PROCESSING DATA TYPES ---------------------

/**
 * @interface BatchEntry
 * @description Đại diện cho một mục được xử lý trong một lô, sau khi xử lý liên kết ban đầu (ví dụ: phân giải URL).
 * Chứa thông tin cần thiết cho các cuộc gọi API AI tiếp theo như `determine_links`.
 */
export interface BatchEntry {
    /**
     * @property {string} conferenceTitle - Tiêu đề của hội nghị.
     */
    conferenceTitle: string;
    /**
     * @property {string} conferenceAcronym - Từ viết tắt của hội nghị.
     */
    conferenceAcronym: string;
    /**
     * @property {string} mainLink - Liên kết chính (URL) đã được phân giải của hội nghị.
     */
    mainLink: string;
    /**
     * @property {string | null} conferenceTextPath - Đường dẫn tệp đến nội dung văn bản đã trích xuất của liên kết hội nghị chính. Null nếu quá trình trích xuất văn bản thất bại.
     */
    conferenceTextPath: string | null;
    /**
     * @property {string} [originalRequestId] - Tùy chọn: ID của yêu cầu gốc, được chuyển tiếp từ `ConferenceData` ban đầu.
     */
    originalRequestId?: string;
    /**
     * @property {number} [linkOrderIndex] - Tùy chọn: Chỉ số của liên kết trong danh sách có thứ tự ban đầu của nó (để theo dõi).
     */
    linkOrderIndex?: number;
    /**
     * @property {string} [cfpLink] - Tùy chọn: Liên kết Call for Papers (CFP) được xác định bởi một mô hình AI.
     */
    cfpLink?: string;
    /**
     * @property {string} [impLink] - Tùy chọn: Liên kết Important Dates (IMP) được xác định bởi một mô hình AI.
     */
    impLink?: string;
    /**
     * @property {string | null} [cfpTextPath] - Tùy chọn: Đường dẫn tệp đến nội dung văn bản đã trích xuất của liên kết CFP. Null nếu quá trình trích xuất thất bại.
     */
    cfpTextPath?: string | null;
    /**
     * @property {string | null} [impTextPath] - Tùy chọn: Đường dẫn tệp đến nội dung văn bản đã trích xuất của liên kết IMP. Null nếu quá trình trích xuất thất bại.
     */
    impTextPath?: string | null;
}

/**
 * @interface BatchUpdateEntry
 * @description Đại diện cho một mục được xử lý trong một lô cho luồng CẬP NHẬT.
 * Chứa các đường dẫn đến các tệp văn bản có sẵn để xử lý mô hình AI.
 */
export interface BatchUpdateEntry {
    /**
     * @property {string} conferenceTitle - Tiêu đề của hội nghị.
     */
    conferenceTitle: string;
    /**
     * @property {string} conferenceAcronym - Từ viết tắt của hội nghị.
     */
    conferenceAcronym: string;
    /**
     * @property {string} mainLink - Liên kết chính của hội nghị.
     */
    mainLink: string;
    /**
     * @property {string} cfpLink - Liên kết CFP của hội nghị.
     */
    cfpLink: string;
    /**
     * @property {string} impLink - Liên kết IMP của hội nghị.
     */
    impLink: string;
    /**
     * @property {string} conferenceTextPath - Đường dẫn tệp đến nội dung văn bản của trang hội nghị chính.
     */
    conferenceTextPath: string;
    /**
     * @property {string | null} cfpTextPath - Đường dẫn tệp đến nội dung văn bản của trang CFP. Null nếu liên kết CFP không khả dụng hoặc quá trình trích xuất văn bản thất bại.
     */
    cfpTextPath: string | null;
    /**
     * @property {string | null} impTextPath - Đường dẫn tệp đến nội dung văn bản của trang Important Dates. Null nếu liên kết IMP không khả dụng hoặc quá trình trích xuất văn bản thất bại.
     */
    impTextPath: string | null;
    /**
     * @property {string} [originalRequestId] - Tùy chọn: ID của yêu cầu gốc, được chuyển tiếp từ `ConferenceUpdateData` ban đầu.
     */
    originalRequestId?: string;
}

// --------------------- JSONL FILE OUTPUT DATA TYPES (AFTER BATCH PROCESSING) ---------------------

/**
 * @interface BatchEntryWithIds
 * @extends BatchEntry
 * @description Đại diện cho cấu trúc dữ liệu hoàn chỉnh của một mục duy nhất sau luồng thu thập dữ liệu LƯU,
 * sẵn sàng được ghi vào tệp JSONL. Bao gồm các ID lô duy nhất và tất cả siêu dữ liệu từ các cuộc gọi API AI.
 */
export interface BatchEntryWithIds extends BatchEntry {
    /**
     * @property {string} internalProcessingAcronym - Từ viết tắt sau khi áp dụng `addAcronymSafely`, để đảm bảo tính duy nhất của tệp nội bộ.
     */
    internalProcessingAcronym: string;
    /**
     * @property {string} batchRequestId - Định danh duy nhất cho cuộc gọi API lô đã xử lý mục này.
     */
    batchRequestId: string;
    /**
     * @property {string} [determineResponseTextPath] - Tùy chọn: Đường dẫn tệp đến văn bản phản hồi thô từ API 'determine_links'.
     */
    determineResponseTextPath?: string;
    /**
     * @property {any} [determineMetaData] - Tùy chọn: Siêu dữ liệu thô hoặc phản hồi có cấu trúc từ API 'determine_links'.
     * (Cân nhắc một kiểu cụ thể hơn nếu lược đồ được biết)
     */
    determineMetaData?: any;
    /**
     * @property {string} [extractResponseTextPath] - Tùy chọn: Đường dẫn tệp đến văn bản phản hồi thô từ API 'extract_information'.
     */
    extractResponseTextPath?: string;
    /**
     * @property {any} [extractMetaData] - Tùy chọn: Siêu dữ liệu thô hoặc phản hồi có cấu trúc từ API 'extract_information'.
     * (Cân nhắc một kiểu cụ thể hơn nếu lược đồ được biết)
     */
    extractMetaData?: any;
    /**
     * @property {string} [cfpResponseTextPath] - Tùy chọn: Đường dẫn tệp đến văn bản phản hồi thô từ API 'extract_cfp'.
     */
    cfpResponseTextPath?: string;
    /**
     * @property {any} [cfpMetaData] - Tùy chọn: Siêu dữ liệu thô hoặc phản hồi có cấu trúc từ API 'extract_cfp'.
     * (Cân nhắc một kiểu cụ thể hơn nếu lược đồ được biết)
     */
    cfpMetaData?: any;
}

/**
 * @interface BatchUpdateDataWithIds
 * @extends BatchUpdateEntry
 * @description Đại diện cho cấu trúc dữ liệu hoàn chỉnh của một mục duy nhất sau luồng thu thập dữ liệu CẬP NHẬT,
 * sẵn sàng được ghi vào tệp JSONL.
 */
export interface BatchUpdateDataWithIds extends BatchUpdateEntry {
    /**
     * @property {string} internalProcessingAcronym - Từ viết tắt sau khi áp dụng `addAcronymSafely`, để đảm bảo tính duy nhất của tệp nội bộ.
     */
    internalProcessingAcronym: string;
    /**
     * @property {string} batchRequestId - Định danh duy nhất cho cuộc gọi API lô đã xử lý mục này.
     */
    batchRequestId: string;
    /**
     * @property {string} [extractResponseTextPath] - Tùy chọn: Đường dẫn tệp đến văn bản phản hồi thô từ API 'extract_information'.
     */
    extractResponseTextPath?: string;
    /**
     * @property {any} [extractMetaData] - Tùy chọn: Siêu dữ liệu thô hoặc phản hồi có cấu trúc từ API 'extract_information'.
     * (Cân nhắc một kiểu cụ thể hơn nếu lược đồ được biết)
     */
    extractMetaData?: any;
    /**
     * @property {string} [cfpResponseTextPath] - Tùy chọn: Đường dẫn tệp đến văn bản phản hồi thô từ API 'extract_cfp'.
     */
    cfpResponseTextPath?: string;
    /**
     * @property {any} [cfpMetaData] - Tùy chọn: Siêu dữ liệu thô hoặc phản hồi có cấu trúc từ API 'extract_cfp'.
     * (Cân nhắc một kiểu cụ thể hơn nếu lược đồ được biết)
     */
    cfpMetaData?: any;
}

// --------------------- RESULT PROCESSING DATA TYPES (READING JSONL, WRITING CSV) ---------------------

/**
 * @interface InputRowData
 * @description Đại diện cho một hàng dữ liệu duy nhất được đọc từ tệp JSONL bởi `ResultProcessingService`.
 * Cấu trúc này phải đủ linh hoạt để chứa cả `BatchEntryWithIds` và `BatchUpdateDataWithIds` vì chúng được ghi vào đầu ra JSONL.
 */
export interface InputRowData {
    /**
     * @property {string} conferenceTitle - Tiêu đề của hội nghị.
     */
    conferenceTitle: string;
    /**
     * @property {string} conferenceAcronym - Từ viết tắt của hội nghị.
     */
    conferenceAcronym: string;
    /**
     * @property {string} [mainLink] - Tùy chọn: Liên kết chính đã được phân giải của hội nghị.
     */
    mainLink?: string;
    /**
     * @property {string | null} [conferenceTextPath] - Tùy chọn: Đường dẫn đến nội dung văn bản của liên kết hội nghị chính.
     */
    conferenceTextPath?: string | null;
    /**
     * @property {string} [cfpLink] - Tùy chọn: Liên kết Call for Papers (CFP) đã xác định.
     */
    cfpLink?: string;
    /**
     * @property {string} [impLink] - Tùy chọn: Liên kết Important Dates (IMP) đã xác định.
     */
    impLink?: string;
    /**
     * @property {string | null} [cfpTextPath] - Tùy chọn: Đường dẫn đến nội dung văn bản của liên kết CFP.
     */
    cfpTextPath?: string | null;
    /**
     * @property {string | null} [impTextPath] - Tùy chọn: Đường dẫn đến nội dung văn bản của liên kết IMP.
     */
    impTextPath?: string | null;

    /**
     * @property {string} [determineResponseTextPath] - Tùy chọn: Đường dẫn đến văn bản phản hồi thô từ API 'determine_links'.
     */
    determineResponseTextPath?: string;
    /**
     * @property {string} [extractResponseTextPath] - Tùy chọn: Đường dẫn đến văn bản phản hồi thô từ API 'extract_information'.
     */
    extractResponseTextPath?: string;
    /**
     * @property {string} [cfpResponseTextPath] - Tùy chọn: Đường dẫn đến văn bản phản hồi thô từ API 'extract_cfp'.
     */
    cfpResponseTextPath?: string;

    /**
     * @property {any} [determineMetaData] - Tùy chọn: Siêu dữ liệu thô hoặc phản hồi có cấu trúc từ API 'determine_links'.
     * (Cân nhắc kiểu cụ thể hơn nếu lược đồ được biết)
     */
    determineMetaData?: any;
    /**
     * @property {any} [extractMetaData] - Tùy chọn: Siêu dữ liệu thô hoặc phản hồi có cấu trúc từ API 'extract_information'.
     * (Cân nhắc kiểu cụ thể hơn nếu lược đồ được biết)
     */
    extractMetaData?: any;
    /**
     * @property {any} [cfpMetaData] - Tùy chọn: Siêu dữ liệu thô hoặc phản hồi có cấu trúc từ API 'extract_cfp'.
     * (Cân nhắc kiểu cụ thể hơn nếu lược đồ được biết)
     */
    cfpMetaData?: any;

    /**
     * @property {string} batchRequestId - ID duy nhất của yêu cầu lô đã tạo ra dữ liệu này. Bắt buộc.
     */
    batchRequestId: string;
    /**
     * @property {string} [originalRequestId] - Tùy chọn: ID của yêu cầu gốc, nếu áp dụng.
     */
    originalRequestId?: string;
}

/**
 * @interface DateDetails
 * @description Định nghĩa một cấu trúc cho ngày nộp bài, thông báo, camera-ready và đăng ký.
 * Điều này có thể được sử dụng để phân tích các loại ngày khác nhau mà tên và giá trị là cần thiết.
 */
export interface DateDetails {
    /**
     * @property {string} [name] - Tên của trường ngày (ví dụ: "abstract_submission_deadline").
     */
    name?: string;
    /**
     * @property {string} [value] - Giá trị của ngày (ví dụ: "2023-12-31").
     */
    value?: string;
}

/**
 * @interface ProcessedResponseData
 * @description Đại diện cho dữ liệu có cấu trúc và được chuẩn hóa được trích xuất từ phản hồi API Gemini.
 * Dữ liệu này thường sẵn sàng để xử lý hoặc lưu trữ thêm.
 */
export interface ProcessedResponseData {
    /**
     * @property {string} conferenceDates - Chuỗi định dạng biểu thị ngày hội nghị.
     */
    conferenceDates: string;
    /**
     * @property {string} year - Năm của hội nghị.
     */
    year: string;
    /**
     * @property {string} location - Chuỗi vị trí chung của hội nghị.
     */
    location: string;
    /**
     * @property {string} cityStateProvince - Thành phố, tiểu bang hoặc tỉnh của vị trí hội nghị.
     */
    cityStateProvince: string;
    /**
     * @property {string} country - Quốc gia của vị trí hội nghị.
     */
    country: string;
    /**
     * @property {string} continent - Châu lục của vị trí hội nghị.
     */
    continent: string;
    /**
     * @property {string} type - Loại sự kiện (ví dụ: "Conference", "Workshop").
     */
    type: string;
    /**
     * @property {Record<string, string | undefined>} submissionDate - Một bản ghi các ngày nộp bài, trong đó các khóa là danh mục và giá trị là các chuỗi ngày.
     */
    submissionDate: Record<string, string | undefined>;
    /**
     * @property {Record<string, string | undefined>} notificationDate - Một bản ghi các ngày thông báo.
     */
    notificationDate: Record<string, string | undefined>;
    /**
     * @property {Record<string, string | undefined>} cameraReadyDate - Một bản ghi các ngày camera-ready.
     */
    cameraReadyDate: Record<string, string | undefined>;
    /**
     * @property {Record<string, string | undefined>} registrationDate - Một bản ghi các ngày đăng ký.
     */
    registrationDate: Record<string, string | undefined>;
    /**
     * @property {Record<string, string | undefined>} otherDate - Một bản ghi bất kỳ ngày quan trọng nào khác.
     */
    otherDate: Record<string, string | undefined>;
    /**
     * @property {string} topics - Một chuỗi hoặc mảng các chủ đề được phân tách bằng dấu phẩy mà hội nghị đề cập.
     */
    topics: string;
    /**
     * @property {string} publisher - Nhà xuất bản của kỷ yếu hội nghị hoặc tạp chí.
     */
    publisher: string;
    /**
     * @property {string} summary - Tóm tắt ngắn gọn về hội nghị hoặc nội dung của nó.
     */
    summary: string;
    /**
     * @property {string} callForPapers - Thông tin liên quan đến Call for Papers.
     */
    callForPapers: string;
    /**
     * @property {string} information - Thông tin chung được trích xuất từ trang web.
     */
    information: string;
}

/**
 * @interface ProcessedRowData
 * @extends ProcessedResponseData
 * @description Đại diện cho cấu trúc dữ liệu cuối cùng, toàn diện cho một hàng đã xử lý,
 * sẵn sàng được ghi vào tệp CSV hoặc trả về cho frontend.
 * Kết hợp siêu dữ liệu ban đầu với dữ liệu phản hồi AI đã xử lý.
 */
export interface ProcessedRowData extends ProcessedResponseData {
    /**
     * @property {string} title - Tiêu đề của hội nghị (từ đầu vào ban đầu).
     */
    title: string;
    /**
     * @property {string} acronym - Từ viết tắt của hội nghị (từ đầu vào ban đầu).
     */
    acronym: string;
    /**
     * @property {string} mainLink - URL chính của hội nghị.
     */
    mainLink: string;
    /**
     * @property {string} cfpLink - URL Call for Papers (CFP).
     */
    cfpLink: string;
    /**
     * @property {string} impLink - URL Important Dates (IMP).
     */
    impLink: string;
    /**
     * @property {Record<string, any>} determineLinks - Siêu dữ liệu có cấu trúc từ cuộc gọi API AI 'determineLinks', nếu có.
     * (Cân nhắc một kiểu cụ thể hơn nếu lược đồ được biết)
     */
    determineLinks: Record<string, any>;
    /**
     * @property {string} requestId - ID duy nhất của yêu cầu lô đã tạo ra hàng đã xử lý này.
     */
    requestId: string;
    /**
     * @property {string} [originalRequestId] - Tùy chọn: ID của yêu cầu gốc, hữu ích để truy tìm dữ liệu nguồn.
     */
    originalRequestId?: string;
    // inputConference?: ConferenceData; // Tùy chọn: Có thể bao gồm đối tượng đầu vào gốc nếu cần
}

// --------------------- GOOGLE SEARCH API TYPES ---------------------

/**
 * @class GoogleSearchError
 * @augments {Error}
 * @description Lớp lỗi tùy chỉnh dành riêng cho các lỗi liên quan đến Google Search API.
 * Mở rộng lớp Error gốc và bao gồm thuộc tính 'details' tùy chọn
 * cho thông tin lỗi có cấu trúc.
 */
export class GoogleSearchError extends Error {
    /**
     * @property {any} details - Chi tiết cấu trúc bổ sung về lỗi.
     * (Sử dụng `any` cho `details` vì cấu trúc của nó có thể thay đổi rộng rãi từ phản hồi của Google API.)
     */
    details: any;

    /**
     * @constructor
     * @param {string} message - Thông báo lỗi.
     * @param {any} [details={}] - Tùy chọn: Chi tiết bổ sung về lỗi (ví dụ: mã trạng thái, đối tượng lỗi cụ thể của Google API).
     */
    constructor(message: string, details: any = {}) {
        super(message);
        this.name = 'GoogleSearchError';
        this.details = details;
        // Điều này rất quan trọng để kiểm tra `instanceof` chính xác trong TypeScript/JavaScript.
        Object.setPrototypeOf(this, GoogleSearchError.prototype);
    }
}

/**
 * @interface GoogleSearchResult
 * @description Đại diện cho một kết quả tìm kiếm duy nhất từ Google Custom Search, được đơn giản hóa cho mục đích sử dụng nội bộ.
 */
export interface GoogleSearchResult {
    /**
     * @property {string} title - Tiêu đề của kết quả tìm kiếm.
     */
    title: string;
    /**
     * @property {string} link - URL của kết quả tìm kiếm.
     */
    link: string;
    /**
     * @property {string} [snippet] - Tùy chọn: Một đoạn nội dung ngắn từ kết quả tìm kiếm.
     */
    snippet?: string;
}

/**
 * @interface GoogleCSEApiResponse
 * @description Giao diện một phần cho cấu trúc phản hồi của Google Custom Search API.
 * Chỉ bao gồm các trường liên quan đến ứng dụng này.
 */
export interface GoogleCSEApiResponse {
    /**
     * @property {GoogleApiItem[]} [items] - Một mảng các mục kết quả tìm kiếm.
     */
    items?: GoogleApiItem[];
    /**
     * @property {GoogleApiErrorBody} [error] - Chi tiết lỗi nếu cuộc gọi API thất bại.
     */
    error?: GoogleApiErrorBody;
}

/**
 * @interface GoogleApiItem
 * @description Đại diện cho một mục duy nhất trong mảng `items` của phản hồi Google Custom Search API.
 */
interface GoogleApiItem {
    /**
     * @property {string} [title] - Tiêu đề của mục kết quả tìm kiếm.
     */
    title?: string;
    /**
     * @property {string} [link] - Liên kết (URL) của mục kết quả tìm kiếm.
     */
    link?: string;
}

/**
 * @interface GoogleApiErrorBody
 * @description Đại diện cho cấu trúc phần thân lỗi từ Google Custom Search API.
 */
interface GoogleApiErrorBody {
    /**
     * @property {number} code - Mã trạng thái HTTP của lỗi.
     */
    code: number;
    /**
     * @property {string} message - Thông báo lỗi chung.
     */
    message: string;
    /**
     * @property {GoogleApiErrorDetail[]} errors - Một mảng các chi tiết lỗi cụ thể hơn.
     */
    errors: GoogleApiErrorDetail[];
}

/**
 * @interface GoogleApiErrorDetail
 * @description Đại diện cho một mục lỗi chi tiết duy nhất trong `GoogleApiErrorBody`.
 */
interface GoogleApiErrorDetail {
    /**
     * @property {string} message - Một thông báo lỗi cụ thể cho chi tiết này.
     */
    message: string;
    /**
     * @property {string} domain - Miền liên quan đến lỗi (ví dụ: 'usageLimits').
     */
    domain: string;
    /**
     * @property {string} reason - Lý do gây ra lỗi (ví dụ: 'dailyLimitExceeded').
     */
    reason: string;
}

// --------------------- DATA MANAGER TYPES (FOR GEMINI CSV DATASETS) ---------------------

/**
 * @interface CsvRowData
 * @description Đại diện cho một hàng dữ liệu duy nhất trong tệp CSV được sử dụng để chuẩn bị tập dữ liệu Gemini.
 * Thường chứa các cột 'input' và 'output'.
 */
export interface CsvRowData {
    /**
     * @property {string} input - Nhắc nhở đầu vào hoặc ngữ cảnh cho mô hình AI.
     */
    input: string;
    /**
     * @property {string} output - Đầu ra hoặc phản hồi mong đợi từ mô hình AI cho đầu vào đã cho.
     */
    output: string;
}

/**
 * @interface InputsOutputs
 * @description Đại diện cho một tập hợp các đầu vào và đầu ra tương ứng của chúng,
 * được sử dụng để chuẩn bị dữ liệu cho việc huấn luyện hoặc đánh giá mô hình AI.
 */
export interface InputsOutputs {
    /**
     * @property {Record<string, string>} inputs - Một bản ghi trong đó các khóa là định danh đầu vào và giá trị là các chuỗi đầu vào.
     */
    inputs: Record<string, string>;
    /**
     * @property {Record<string, string>} outputs - Một bản ghi trong đó các khóa là định danh đầu ra và giá trị là các chuỗi đầu ra.
     */
    outputs: Record<string, string>;
}