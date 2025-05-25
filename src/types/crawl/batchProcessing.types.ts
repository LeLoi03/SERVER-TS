/**
 * @fileoverview Định nghĩa các kiểu dữ liệu liên quan đến quá trình xử lý theo lô (batch processing) và ghi nhật ký.
 * Mục đích là cung cấp cấu trúc rõ ràng cho các ngữ cảnh ghi nhật ký trong các tác vụ xử lý hàng loạt.
 */

/**
 * @typedef {object} LogContextBase
 * @description Kiểu cơ sở cho ngữ cảnh ghi nhật ký, chứa các thông tin chung về một tác vụ.
 * @property {number} batchIndex - Chỉ số của lô (batch) hiện tại đang được xử lý.
 * @property {string | undefined} conferenceAcronym - Từ viết tắt của hội nghị, có thể là undefined.
 * @property {string | undefined} [originalConferenceAcronym] - Từ viết tắt gốc của hội nghị, nếu có sự thay đổi hoặc làm rõ.
 * @property {string | undefined} [internalProcessingAcronym] - Từ viết tắt nội bộ được sử dụng trong quá trình xử lý.
 * @property {string | undefined} conferenceTitle - Tiêu đề đầy đủ của hội nghị, có thể là undefined.
 * @property {string} function - Tên của hàm hoặc module đang thực hiện tác vụ.
 * @property {1 | 2} [apiCallNumber] - Số thứ tự của cuộc gọi API (ví dụ: 1 cho lần thử đầu tiên, 2 cho lần thử lại).
 */
export type LogContextBase = {
    batchIndex: number;
    conferenceAcronym: string | undefined;
    originalConferenceAcronym?: string;
    internalProcessingAcronym?: string;
    conferenceTitle: string | undefined;
    function: string;
    apiCallNumber?: 1 | 2;
};

/**
 * @interface BatchProcessingLogContext
 * @extends LogContextBase
 * @description Mở rộng LogContextBase để bao gồm các chi tiết cụ thể hơn cho ngữ cảnh ghi nhật ký trong quá trình xử lý lô.
 */
export interface BatchProcessingLogContext extends LogContextBase {
    /**
     * @property {number} batchIndex - Chỉ số của lô (batch) hiện tại đang được xử lý (được kế thừa nhưng được làm rõ là bắt buộc).
     */
    batchIndex: number;
    /**
     * @property {string} conferenceAcronym - Từ viết tắt của hội nghị (được kế thừa nhưng được làm rõ là bắt buộc).
     */
    conferenceAcronym: string;
    /**
     * @property {string} conferenceTitle - Tiêu đề đầy đủ của hội nghị (được kế thừa nhưng được làm rõ là bắt buộc).
     */
    conferenceTitle: string;
    /**
     * @property {'full_links' | 'main_link' | 'update_intermediate' | 'determine_response' | 'extract_response' | 'cfp_response' | 'initial_text'} [fileType] - Loại tệp dữ liệu đang được xử lý hoặc ghi nhật ký.
     */
    fileType?: 'full_links' | 'main_link' | 'update_intermediate' | 'determine_response' | 'extract_response' | 'cfp_response' | 'initial_text';
    /**
     * @property {'determine_api' | 'extract_cfp_api'} [aggregationPurpose] - Mục đích tổng hợp liên quan đến API.
     */
    aggregationPurpose?: 'determine_api' | 'extract_cfp_api';
    /**
     * @property {'determine' | 'extract' | 'cfp'} [apiType] - Loại cuộc gọi API đang được thực hiện.
     */
    apiType?: 'determine' | 'extract' | 'cfp';
    /**
     * @property {'main' | 'cfp' | 'imp'} [contentType] - Loại nội dung liên quan (ví dụ: chính, CFP, quan trọng).
     */
    contentType?: 'main' | 'cfp' | 'imp';
    /**
     * @property {string} [event_group] - Nhóm sự kiện mà bản ghi này thuộc về.
     */
    event_group?: string;
    /**
     * @property {number} [linkIndex] - Chỉ số của liên kết (link) trong một danh sách.
     */
    linkIndex?: number;
    /**
     * @property {string} [originalUrl] - URL gốc trước khi có bất kỳ thay đổi hoặc chuyển hướng nào.
     */
    originalUrl?: string;
    /**
     * @property {string} [url] - URL hiện tại đang được xử lý.
     */
    url?: string;
    /**
     * @property {string} [finalUrl] - URL cuối cùng sau tất cả các chuyển hướng hoặc xử lý.
     */
    finalUrl?: string;
    /**
     * @property {'main' | 'cfp' | 'imp' | 'modified' | 'original'} [linkType] - Loại của liên kết.
     */
    linkType?: 'main' | 'cfp' | 'imp' | 'modified' | 'original';
    /**
     * @property {number | null} [status] - Mã trạng thái HTTP hoặc trạng thái xử lý, có thể là null.
     */
    status?: number | null;
}