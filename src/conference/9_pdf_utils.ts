import axios, { AxiosResponse, isAxiosError } from 'axios';
import pdf from 'pdf-parse'; // pdf-parse types should be installed via @types/pdf-parse

/**
 * Trích xuất văn bản từ tệp PDF tại URL được cung cấp.
 * Chỉ xử lý các tệp PDF có tối đa 3 trang.
 *
 * @param pdfUrl URL của tệp PDF cần xử lý.
 * @returns Promise chứa văn bản được trích xuất (string) nếu thành công và PDF <= 3 trang,
 *          hoặc null nếu có lỗi xảy ra hoặc PDF > 3 trang.
 */
export const extractTextFromPDF = async (pdfUrl: string): Promise<string | null> => {
    try {
        // Gửi request và nhận dữ liệu PDF dưới dạng ArrayBuffer
        // Explicitly type the response data as ArrayBuffer
        const response: AxiosResponse<ArrayBuffer> = await axios.get(pdfUrl, {
            responseType: 'arraybuffer',
            // Thêm timeout để tránh request bị treo vô thời hạn
            timeout: 15000, // 15 giây
            // Có thể thêm các headers cần thiết, ví dụ User-Agent
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' // Ví dụ
            }
        });

        // Check for HTTP errors (axios sẽ throw error cho 4xx/5xx nên check này có thể dư thừa, nhưng để chắc chắn)
        if (response.status !== 200) {
            console.error(`Error fetching PDF from ${pdfUrl}: HTTP status ${response.status}`);
            return null;
        }

        // Check if response.data is valid (not empty or corrupted)
        // response.data sẽ là ArrayBuffer do responseType được set
        if (!response.data || response.data.byteLength === 0) {
            console.error(`Error: Empty or invalid PDF data received from ${pdfUrl}`);
            return null;
        }

        // Chuyển ArrayBuffer thành Buffer (yêu cầu của pdf-parse)
        // Buffer là kiểu dữ liệu của Node.js, đảm bảo @types/node đã được cài đặt
        const pdfBuffer: Buffer = Buffer.from(response.data);

        // Dùng pdf-parse để trích xuất văn bản
        // pdfData sẽ có kiểu được suy ra từ @types/pdf-parse, thường là một object
        // chứa numpages, text, info, metadata, version.
        let pdfData;
        try {
            // Type của pdfData được suy luận từ kết quả của pdf()
            pdfData = await pdf(pdfBuffer);
        } catch (parseError: unknown) { // Bắt lỗi dưới dạng 'unknown'
            console.error(`Error parsing PDF from ${pdfUrl}:`);
            if (parseError instanceof Error) {
                console.error(parseError.message);
            } else {
                console.error('An unknown parsing error occurred:', parseError);
            }
            return null; // Return null for parsing failures.
        }

        // Kiểm tra số trang
        // TypeScript sẽ kiểm tra xem pdfData có thuộc tính 'numpages' hay không nếu types được định nghĩa đúng
        if (typeof pdfData?.numpages === 'number' && pdfData.numpages > 3) {
            // console.log(`PDF ${pdfUrl} has ${pdfData.numpages} pages, skipping...`);
            return null; // Bỏ qua PDF dài hơn 3 trang
        }

        // Trả về văn bản đã trích xuất nếu số trang <= 3
        // TypeScript sẽ kiểm tra xem pdfData có thuộc tính 'text' hay không
        if (typeof pdfData?.text === 'string') {
            return pdfData.text;
        } else {
            console.error(`Could not extract text from PDF ${pdfUrl}, pdfData.text is not a string.`);
            return null;
        }

    } catch (error: unknown) { // Bắt lỗi dưới dạng 'unknown' cho type safety
        // Handle Axios và network errors sử dụng type guard của Axios
        if (isAxiosError(error)) {
            if (error.response) {
                // Server đã trả về response với status code lỗi (4xx, 5xx)
                console.error(`Error fetching PDF from ${pdfUrl} (HTTP Error): Status ${error.response.status}`);
                // error.response.data có thể là text hoặc object tùy vào cách server trả lỗi
                // Nếu là ArrayBuffer, có thể cần xử lý thêm để log
                 try {
                    // Thử decode nếu là buffer/arraybuffer lỗi (ví dụ text lỗi)
                    if (error.response.data instanceof ArrayBuffer || Buffer.isBuffer(error.response.data)) {
                        console.error("Error details (raw buffer):", Buffer.from(error.response.data).toString('utf-8', 0, 100)); // Log 100 byte đầu
                    } else {
                        console.error("Error details:", error.response.data);
                    }
                } catch (decodeError) {
                    console.error("Error details: (Could not decode error response data)");
                }

            } else if (error.request) {
                // Request đã được gửi nhưng không nhận được response (lỗi mạng, timeout, ...)
                console.error(`Error fetching PDF from ${pdfUrl} (No Response): ${error.message}`);
            } else {
                // Lỗi xảy ra khi thiết lập request
                console.error(`Error fetching PDF from ${pdfUrl} (Request Setup Error): ${error.message}`);
            }
             // Log thêm config và code nếu cần debug sâu hơn
            // console.error('Axios Config:', error.config);
             if (error.code) {
                 console.error('Error Code:', error.code);
             }
        } else if (error instanceof Error) {
             // Handle các lỗi JavaScript thông thường khác
             console.error(`Unexpected error processing PDF ${pdfUrl}: ${error.message}`);
             console.error(error.stack); // Log stack trace cho các lỗi không phải Axios
        } else {
            // Xử lý các trường hợp lỗi không xác định khác
             console.error(`An unknown error occurred processing ${pdfUrl}:`, error);
        }
        return null;
    }
};