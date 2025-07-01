// test_api.js
import axios from 'axios';

const API_CONFERENCE_ENDPOINT = 'http://localhost:3001/api/v1/crawl-conferences';

// **********************************
// *** CẤU HÌNH CHO BUỔI TEST ***
// **********************************

// CHỌN CHẾ ĐỘ THỰC THI: 'sync' hoặc 'async'
// 'sync': Đợi cho đến khi crawl xong và nhận lại dữ liệu.
// 'async': Nhận response 202 ngay lập tức và tiến trình chạy nền.
const EXECUTION_MODE = 'sync'; // <-- THAY ĐỔI Ở ĐÂY

// CHỌN CÓ GHI FILE KẾT QUẢ KHÔNG: true hoặc false
// true: Sẽ tạo ra file JSONL và CSV trong thư mục output.
// false: Sẽ không tạo file, chỉ xử lý trong bộ nhớ và trả về kết quả.
const RECORD_FILES = false; // <-- THAM SỐ MỚI, THAY ĐỔI Ở ĐÂY

const TEST_DESCRIPTION = `Test crawl in '${EXECUTION_MODE}' mode, recordFile=${RECORD_FILES}, from test_api.js`;

const API_MODELS_TO_USE = {
    determineLinks: 'non-tuned',
    extractInfo: 'non-tuned',
    extractCfp: 'non-tuned'
};

const conferenceItems = [
    {
        "Title": "ACM SIGMOD-SIGACT-SIGART Conference on Principles of Database Systems",
        "Acronym": "PODS",
        "mainLink": "https://2025.sigmod.org/",
        "cfpLink": "https://2025.sigmod.org/calls_papers_pods_research.shtml",
        "impLink": "https://2025.sigmod.org/calls_papers_important_dates.shtml"
    },
    {
        "Title": "International Conference on Machine Learning",
        "Acronym": "ICML",
        // Luồng CRAWL
    },
    {
        "Title": "Conference on Neural Information Processing Systems",
        "Acronym": "NeurIPS",
        "mainLink": "https://nips.cc/",
        "cfpLink": "https://nips.cc/Conferences/2024/CallForPapers",
    },
];

async function crawlConferences() {
    console.log(`--- Starting Conference Test (Mode: ${EXECUTION_MODE}, Record Files: ${RECORD_FILES}) ---`);
    try {
        const requestPayload = {
            items: conferenceItems,
            models: API_MODELS_TO_USE,
            recordFile: RECORD_FILES, // <<< THÊM THAM SỐ MỚI VÀO PAYLOAD
        };

        if (typeof TEST_DESCRIPTION !== 'undefined') {
            requestPayload.description = TEST_DESCRIPTION;
        }

        console.log('Sending API request with payload:');
        console.log(JSON.stringify(requestPayload, null, 2));

        // Thêm cả dataSource và mode vào query params
        const params = {
            dataSource: 'client',
            mode: EXECUTION_MODE
        };

        console.log(`\nCalling endpoint: ${API_CONFERENCE_ENDPOINT} with params:`, params);

        const response = await axios.post(API_CONFERENCE_ENDPOINT, requestPayload, {
            params: params,
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 300000 // Tăng timeout lên 5 phút cho các request sync lớn
        });

        console.log('\n--- Backend Response ---');
        console.log('Status:', response.status);
        console.log('Message:', response.data.message);
        console.log('Description Received by Server:', response.data.description);

        // Xử lý response dựa trên status code
        if (response.status === 202) { // Chế độ ASYNC
            console.log('\n--- Asynchronous Mode Detected ---');
            console.log('Batch Request ID:', response.data.batchRequestId);
            console.log('Process is running in the background. Use the Batch ID to check status or stop the process.');
        } else if (response.status === 200) { // Chế độ SYNC
            console.log('\n--- Synchronous Mode Detected ---');
            console.log('Runtime:', response.data.runtime);
            // Các đường dẫn này chỉ có thể tồn tại nếu recordFile=true, nhưng chúng ta không nhận lại chúng từ server nữa.
            // Có thể xóa các dòng log này hoặc giữ lại để kiểm tra nếu bạn quyết định trả về chúng trong tương lai.
            // if (response.data.outputJsonlPath) {
            //     console.log('Output JSONL Path:', response.data.outputJsonlPath);
            // }
            // if (response.data.outputCsvPath) {
            //     console.log('Output CSV Path:', response.data.outputCsvPath);
            // }

            if (response.data.data) {
                if (Array.isArray(response.data.data) && response.data.data.length > 0) {
                    console.log(`\n--- Processed Results Received (${response.data.data.length}) ---`);
                    console.log("First processed result sample:", JSON.stringify(response.data.data[0], null, 2));
                    if (response.data.data.length > 1) {
                        console.log("Last processed result sample:", JSON.stringify(response.data.data[response.data.data.length - 1], null, 2));
                    }
                } else if (Array.isArray(response.data.data) && response.data.data.length === 0) {
                    console.log('\n--- Processed Results Received (Empty Array) ---');
                    console.log("The process completed, but the returned data array is empty.");
                } else {
                    console.warn('\n--- Warning: Received "data" field is not a non-empty array ---');
                    console.log('Raw "data" field:', response.data.data);
                }
            } else {
                console.log('\n--- No "data" field received in the synchronous response. ---');
            }
        }

    } catch (error) {
        console.error('\n--- Error Occurred ---');
        if (error.response) {
            console.error('Error Status:', error.response.status);
            console.error('Error Message from Server:', error.response.data?.message || 'No message field');
            console.error('Error Details:', JSON.stringify(error.response.data?.error || error.response.data, null, 2));
            if (error.response.data?.description) {
                 console.error('Request Description (from error response):', error.response.data.description);
            }
        } else if (error.request) {
            console.error('Error Request:', 'No response received from the server. Is the server running?');
            console.error('API Endpoint:', API_CONFERENCE_ENDPOINT);
        } else {
            console.error('Error Setting Up Request:', error.message);
        }
    } finally {
        console.log('\n--- Test Finished ---');
    }
}

// Gọi hàm test
crawlConferences();